import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegStatic from 'ffmpeg-static';
if (ffmpegStatic) {
  (ffmpeg as unknown as { setFfmpegPath: (p: string) => void }).setFfmpegPath(ffmpegStatic as unknown as string);
}
import { generateVideo } from '../tasks/video-generator.js';
import type { AppSettings } from '../../src/core/settings.js';
import type { Page } from 'playwright';

async function ensureDir(p: string) {
  await fs.mkdir(p, { recursive: true });
}

function asArray<T>(v: T | T[] | undefined): T[] {
  if (!v) return [];
  return Array.isArray(v) ? v : [v];
}

// Try to resolve a direct media URL from a page URL using ytdlp-nodejs or the bundled binary fallback
async function resolveDirectUrl(pageUrl: string): Promise<string | null> {
  try {
    const mod = await import('ytdlp-nodejs');
    const anyMod = mod as unknown as { default?: unknown; ytdlp?: unknown };
    const ytdlp = (anyMod?.default as unknown) || (anyMod?.ytdlp as unknown) || (mod as unknown);
    if (typeof ytdlp === 'function') {
        const info = await (ytdlp as (u: string, o?: Record<string, unknown>) => Promise<Record<string, unknown>>)(pageUrl, { dumpSingleJson: true, noWarnings: true });
        const candidates = asArray(info?.url as string | string[] | undefined).concat(asArray(info?.webpage_url as string | string[] | undefined));
      if (candidates.length > 0) return candidates[0] as string;
    }
  } catch {
    // ignore module resolution issues and fall back to binary
  }
  // Fallback to binary
  const bin = path.join(process.cwd(), 'node_modules', 'ytdlp-nodejs', 'bin', process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');
  try {
    const { execFile } = await import('node:child_process');
    const stdout: string = await new Promise((resolve, reject) => {
      execFile(bin, ['-J', pageUrl], { timeout: 60_000 }, (err, out, _errOut) => {
        if (err) return reject(err);
        resolve(out);
      });
    });
  const info = JSON.parse(stdout as unknown as string) as Record<string, unknown>;
  const candidates = asArray(info?.url as string | string[] | undefined).concat(asArray(info?.webpage_url as string | string[] | undefined));
    if (candidates.length > 0) return candidates[0] as string;
  } catch (e) {
  const err = e as Error;
  console.error('yt-dlp fallback failed:', err.message || String(e));
  }
  return null;
}

async function main() {
  const url1 = process.env.URL_YT || '';
  const url2 = process.env.URL_TT || '';
  const url3 = process.env.URL_X || '';
  const url4 = process.env.URL_IG || '';
  const urls = [url1, url2, url3, url4].filter(Boolean);
  if (urls.length === 0) {
    console.error('No URLs provided. Set env URL_YT / URL_TT / URL_X / URL_IG.');
    process.exit(1);
  }

  const tmpRoot = path.join(os.tmpdir(), 'svt_runs');
  const testData = path.join(tmpRoot, 'data');
  const outDir = path.join(tmpRoot, 'out');
  await ensureDir(testData);
  await ensureDir(outDir);

  // Generate dummy background and bgm
  await new Promise<void>((resolve, reject) => {
    ffmpeg()
      .input('color=c=black:s=1080x1920:d=10')
      .inputOptions(['-f', 'lavfi'])
      .outputOptions(['-pix_fmt', 'yuv420p'])
      .on('end', () => resolve())
      .on('error', (err) => reject(err))
      .save(path.join(testData, 'background.mp4'));
  });
  await new Promise<void>((resolve, reject) => {
    ffmpeg()
      .input('sine=frequency=800:duration=10')
      .inputOptions(['-f', 'lavfi'])
      .outputOptions(['-ac', '2', '-ar', '44100'])
      .on('end', () => resolve())
      .on('error', (err) => reject(err))
      .save(path.join(testData, 'bgm.wav'));
  });
  // Create a tiny placeholder screenshot in case X fails; will be replaced if X screenshot succeeds
  await new Promise<void>((resolve, reject) => {
    ffmpeg()
      .input('color=c=red:s=800x800:d=0.1')
      .inputOptions(['-f', 'lavfi'])
      .outputOptions(['-frames:v', '1'])
      .on('end', () => resolve())
      .on('error', (err) => reject(err))
      .save(path.join(testData, 'screenshot.png'));
  });

  const baseSettings: AppSettings = {
    general: { outputPath: outDir },
    platforms: {
      x: { enabled: false, accounts: [], intervalMinutes: 15, scrapeDelayMs: 0 },
      tiktok: { enabled: false, accounts: [], intervalMinutes: 15, scrapeDelayMs: 0 },
      instagram: { enabled: false, accounts: [], intervalMinutes: 15, scrapeDelayMs: 0 },
      youtube: { enabled: false, accounts: [], intervalMinutes: 15, scrapeDelayMs: 0 },
    },
    render: {
      resolution: { width: 1080, height: 1920 },
      durationSec: 10,
      bgmPath: path.join(testData, 'bgm.wav'),
      backgroundVideoPath: path.join(testData, 'background.mp4'),
      captions: { top: 'AUTO_TOP', bottom: 'AUTO_BOTTOM' },
      scale: 0.8,
      teleTextBg: '#000000',
      qualityPreset: 'standard',
      overlayPosition: 'center',
      topCaptionHeight: 120,
      bottomCaptionHeight: 160,
      captionBgOpacity: 1,
    },
  };

  // Helper: download a video file using yt-dlp binary
  async function downloadVideo(pageUrl: string, destDir: string): Promise<string> {
    await ensureDir(destDir);
    const safeName = pageUrl.replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, 80);
    const outPath = path.join(destDir, `${safeName}.mp4`);
    const bin = path.join(process.cwd(), 'node_modules', 'ytdlp-nodejs', 'bin', process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');
    const { execFile } = await import('node:child_process');
    await new Promise<void>((resolve, reject) => {
      const args = [
        pageUrl,
        '-o', outPath,
        '-f', 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best',
        '--merge-output-format', 'mp4',
        '--no-playlist',
        '--no-warnings'
      ];
      execFile(bin, args, { timeout: 180_000 }, (err) => {
        if (err) return reject(err);
        resolve();
      });
    });
    return outPath;
  }

  // Helper: capture X post screenshot using Playwright
  async function captureXPostScreenshot(postUrl: string, destPath: string): Promise<boolean> {
    const { chromium } = await import('playwright');
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1200, height: 2000 } });
    const page: Page = await context.newPage();
    try {
      await page.goto(postUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
      // できるだけ描画が落ち着くまで待機
      await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});
      const article = page.locator('article[role="article"]').first();
      await article.waitFor({ state: 'visible', timeout: 30_000 });
      await article.screenshot({ path: destPath });
      return true;
    } catch (e) {
      const err = e as Error;
      console.error('X screenshot failed:', err.message || String(e));
      // フォールバック: ページ全体のスクショ
      try {
        await page.screenshot({ path: destPath, fullPage: true });
        return true;
      } catch { /* swallow */ }
      return false;
    } finally {
      await context.close();
      await browser.close();
    }
  }

  const results: string[] = [];

  for (const u of urls) {
    try {
      const kind = u.includes('youtube.com') || u.includes('youtu.be') ? 'YouTubeShorts' : u.includes('tiktok.com') ? 'TikTok' : u.includes('x.com') || u.includes('twitter.com') ? 'X' : 'Other';
      const id = u.split('/').pop()?.split('?')[0] || '';
      const settings: AppSettings = {
        ...baseSettings,
        render: { ...baseSettings.render, captions: { top: kind, bottom: id } },
      } as AppSettings;

      if (kind === 'X') {
        // Xはポストをスクショし、その画像を背景に重ねる
        const ssPath = path.join(testData, `xshot-${Date.now()}.png`);
        const ok = await captureXPostScreenshot(u, ssPath);
        const screenshotToUse = ok ? ssPath : path.join(testData, 'screenshot.png');
        const out = await generateVideo(screenshotToUse, settings);
        results.push(out);
      } else {
        // 他は実動画をダウンロードして再エンコード
        const downloaded = await downloadVideo(u, path.join(tmpRoot, 'downloads'));
        const out = await generateVideo('', settings, downloaded);
        results.push(out);
      }
    } catch (e) {
      const err = e as Error;
      console.error('Failed to generate for URL:', u, '\n', err.message || String(e));
    }
  }

  console.log('Outputs:');
  for (const r of results) console.log('  ' + r);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
