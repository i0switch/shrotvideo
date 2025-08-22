import path from 'node:path';
import fs from 'node:fs/promises';
import { mkdirSync } from 'node:fs';
import os from 'node:os';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegStatic from 'ffmpeg-static';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { AppSettings, Platform } from '../../src/core/settings.js';
import { generateVideo } from '../tasks/video-generator.js';

const execFileAsync = promisify(execFile);

// Ensure ffmpeg binary
try {
  if (ffmpegStatic) {
    (ffmpeg as unknown as { setFfmpegPath: (p: string) => void }).setFfmpegPath(ffmpegStatic as unknown as string);
  }
} catch { /* ignore */ }

type AccountInput = { platform: Platform; url: string; accountId: string };

function detectPlatformAndAccount(url: string): AccountInput | null {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    const parts = u.pathname.split('/').filter(Boolean);
    if (host.includes('x.com') || host.includes('twitter.com')) {
      const id = parts[0] || '';
      if (!id) return null;
      return { platform: 'x', url, accountId: id };
    }
    if (host.includes('tiktok.com')) {
      // /@username
      const at = parts[0] || '';
      const id = at.startsWith('@') ? at.slice(1) : at;
      if (!id) return null;
      return { platform: 'tiktok', url, accountId: id };
    }
    if (host.includes('instagram.com')) {
      const id = (parts[0] || '').replace(/\/$/, '');
      if (!id) return null;
      return { platform: 'instagram', url, accountId: id };
    }
    if (host.includes('youtube.com') || host.includes('youtu.be')) {
      // Expect /@handle or channel URL; prefer handle without @ for our settings helper
      let id = '';
      const atIdx = parts.findIndex(p => p.startsWith('@'));
      if (atIdx >= 0) id = (parts[atIdx] || '').replace(/^@/, '');
      if (!id) {
        // fallback: try channel name segment
        id = parts[0] || '';
      }
      if (!id) return null;
      return { platform: 'youtube', url, accountId: id };
    }
  } catch { /* ignore */ }
  return null;
}

async function ensureDir(p: string) {
  await fs.mkdir(p, { recursive: true }).catch(() => {});
}

async function ytdlpJson(url: string): Promise<Record<string, unknown>> {
  // Prefer system yt-dlp if available via ytdlp-nodejs bin
  const bin = path.join(process.cwd(), 'node_modules', 'ytdlp-nodejs', 'bin', process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');
  const args = ['-J', url];
  // Improve YouTube extraction by using mobile player client
  if (/youtube\.com|youtu\.be/i.test(url)) {
    args.push('--extractor-args', 'youtube:player_client=android,ios');
  }
  const { stdout } = await execFileAsync(bin, args, { timeout: 120_000 });
  return JSON.parse(stdout);
}

async function downloadVideo(pageUrl: string, destDir: string): Promise<string> {
  await ensureDir(destDir);
  const safeName = pageUrl.replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, 80);
  const outPath = path.join(destDir, `${safeName}.mp4`);
  const bin = path.join(process.cwd(), 'node_modules', 'ytdlp-nodejs', 'bin', process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');
  const args = [
    pageUrl,
    '-o', outPath,
    '-f', 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best',
    '--merge-output-format', 'mp4',
    '--no-playlist',
    '--no-warnings',
  ];
  if (/youtube\.com|youtu\.be/i.test(pageUrl)) {
    args.push('--extractor-args', 'youtube:player_client=android,ios');
  }
  await execFileAsync(bin, args, { timeout: 300_000 });
  return outPath;
}

async function collectYouTubeTikTokInstagram(pageUrl: string, limit: number): Promise<string[]> {
  const json = await ytdlpJson(pageUrl);
  const entries = Array.isArray((json as { entries?: unknown }).entries) ? (json as { entries: any[] }).entries : [];
  const urls: string[] = [];
  for (const e of entries) {
    const u = (e?.webpage_url as string) || (e?.original_url as string) || (e?.url as string);
    if (u) urls.push(u);
    if (urls.length >= limit) break;
  }
  return urls;
}

async function collectXScreenshots(pageUrl: string, limit: number, destDir: string): Promise<string[]> {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1200, height: 2000 } });
  const page = await context.newPage();
  const outputs: string[] = [];
  try {
    await page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});
    const articles = page.locator('article[role="article"]');
    await articles.first().waitFor({ state: 'visible', timeout: 60_000 });

    // Try to load more by auto-scrolling until we have enough or no progress
    let prevCount = 0;
    let stagnant = 0;
    for (let attempt = 0; attempt < 12; attempt++) {
      const countNow = await articles.count();
      if (countNow >= limit) break;
      if (countNow === prevCount) stagnant++;
      else stagnant = 0;
      if (stagnant >= 3) break;
      prevCount = countNow;
      await page.mouse.wheel(0, 3000);
      await page.waitForTimeout(800);
      await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => {});
    }
    const count = Math.min(await articles.count(), limit);
    for (let i = 0; i < count; i++) {
      const loc = articles.nth(i);
      await loc.scrollIntoViewIfNeeded();
      const file = path.join(destDir, `xshot-${i + 1}.png`);
      await loc.screenshot({ path: file });
      outputs.push(file);
    }
  } finally {
    await context.close();
    await browser.close();
  }
  return outputs;
}

async function collectGenericScreenshots(pageUrl: string, limit: number, destDir: string, platform: 'tiktok'|'instagram'|'youtube'): Promise<string[]> {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ headless: true });
  // Use mobile-like context by default for Instagram to improve infinite scroll
  let context = await browser.newContext(
    platform === 'instagram'
      ? ({ viewport: { width: 430, height: 900 }, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1', isMobile: true, deviceScaleFactor: 3 } as any)
      : ({ viewport: { width: 1600, height: 2500 } })
  );
  let page = await context.newPage();
  const outputs: string[] = [];
  try {
    // For Instagram, optionally preload cookies or login to avoid early modal/login wall
    if (platform === 'instagram') {
      // Try cookies file first
      try {
        const cookieFile = path.join(process.cwd(), 'test-data', 'instagram-cookies.json');
        const raw = await fs.readFile(cookieFile, 'utf8').catch(() => '');
        if (raw) {
          const cookies = JSON.parse(raw);
          if (Array.isArray(cookies) && cookies.length) {
            const mapped = cookies.map((c: any) => ({
              name: String(c.name),
              value: String(c.value),
              domain: (c.domain ?? '.instagram.com') as string,
              path: (c.path ?? '/') as string,
              httpOnly: Boolean(c.httpOnly ?? false),
              secure: Boolean(c.secure ?? true),
              sameSite: (c.sameSite ?? 'Lax') as 'Lax'|'None'|'Strict',
              expires: typeof c.expires === 'number' ? c.expires : -1,
            }));
            await context.addCookies(mapped);
          }
        }
      } catch { /* ignore cookie issues */ }
      // If env credentials are provided, attempt a quick login flow
      if (process.env.IG_USERNAME && process.env.IG_PASSWORD) {
        try {
          await page.goto('https://www.instagram.com/accounts/login/', { waitUntil: 'domcontentloaded', timeout: 60_000 });
          await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});
          // Accept cookies banner if present
          await page.locator('button:has-text("Accept")').first().click({ timeout: 5_000 }).catch(() => {});
          await page.locator('input[name="username"]').fill(process.env.IG_USERNAME, { timeout: 30_000 });
          await page.locator('input[name="password"]').fill(process.env.IG_PASSWORD, { timeout: 30_000 });
          await page.locator('button[type="submit"]').click({ timeout: 30_000 });
          await page.waitForLoadState('networkidle', { timeout: 60_000 }).catch(() => {});
          // Dismiss post-login dialogs if any
          await page.locator('button:has-text("Not Now")').first().click({ timeout: 5_000 }).catch(() => {});
        } catch { /* ignore login errors and continue */ }
      }
    }

  await page.goto(platform === 'instagram' ? pageUrl.replace('://www.', '://m.') : pageUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    // Try to dismiss regional cookie banners or login nags that obscure content
    const dismissors = [
      'button:has-text("Accept All")',
      'button:has-text("Allow all")',
      'button:has-text("Accept")',
      'button:has-text("同意")',
      'button:has-text("許可")',
      'button:has-text("Not Now")',
      'div[role="dialog"] button:has-text("Not Now")',
    ];
    for (const sel of dismissors) {
      await page.locator(sel).first().click({ timeout: 2000 }).catch(() => {});
    }
    await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});
    let locatorStr = '';
  if (platform === 'tiktok') {
      locatorStr = 'a[href*="/video/"]';
    } else if (platform === 'instagram') {
      // Prefer profile grid items; cover both posts and reels
      locatorStr = 'main div[role="grid"] a[href*="/p/"], main div[role="grid"] a[href*="/reel/"]';
    } else {
      // youtube shorts shelf
      locatorStr = 'ytd-reel-item-renderer, a[href^="/shorts/"]';
    }
    // On Instagram, wait explicitly for grid; if not found, try mitigations
    let items = page.locator(locatorStr);
    if (platform === 'instagram') {
      const grid = page.locator('main div[role="grid"]').first();
      const gridOk = await grid.isVisible().catch(() => false);
      if (!gridOk) {
        // Hide potential modal overlays (login gate, cookie banners)
        await page.addStyleTag({ content: '*[role="dialog"], div[role="presentation"], ._a9-_, ._a9--, ._a9-z { display: none !important; } body { overflow: auto !important; }' }).catch(() => {});
      }
      // Relax selector if grid still not visible
      const ready = await grid.waitFor({ state: 'visible', timeout: 5000 }).then(() => true).catch(() => false);
      if (!ready) {
        locatorStr = 'a[href*="/p/"], a[href*="/reel/"]';
        items = page.locator(locatorStr);
      }
      // If still no items, try mobile site in a fresh context
      let hasAny = await items.first().isVisible().catch(() => false);
      if (!hasAny) {
        try {
          await context.close();
          context = await browser.newContext({
            viewport: { width: 430, height: 900 },
            userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
            isMobile: true,
            deviceScaleFactor: 3,
          } as any);
          const mpage = await context.newPage();
          await mpage.goto(pageUrl.replace('://www.', '://m.'), { waitUntil: 'domcontentloaded', timeout: 60_000 });
          await mpage.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});
          await mpage.addStyleTag({ content: '*[role="dialog"], div[role="presentation"], ._a9-_, ._a9--, ._a9-z { display: none !important; } body { overflow: auto !important; }' }).catch(() => {});
          locatorStr = 'a[href*="/p/"], a[href*="/reel/"]';
          items = mpage.locator(locatorStr);
          // Replace page reference to continue below
          (page as any).close?.().catch(() => {});
          // @ts-ignore
          page = mpage;
        } catch { /* ignore */ }
      }
    }
    try {
      await items.first().waitFor({ state: 'visible', timeout: 60_000 });
    } catch (e) {
      if (platform === 'instagram') {
        // Fallback to desktop context if mobile couldn’t reveal items
        try {
          await context.close().catch(() => {});
          context = await browser.newContext({ viewport: { width: 1600, height: 2500 } });
          page = await context.newPage();
          await page.goto(pageUrl.replace('://m.', '://www.'), { waitUntil: 'domcontentloaded', timeout: 60_000 });
          // Dismiss banners
          const dismissors = [
            'button:has-text("Accept All")', 'button:has-text("Allow all")', 'button:has-text("Accept")',
            'button:has-text("同意")', 'button:has-text("許可")', 'button:has-text("Not Now")', 'div[role="dialog"] button:has-text("Not Now")'
          ];
          for (const sel of dismissors) {
            await page.locator(sel).first().click({ timeout: 2000 }).catch(() => {});
          }
          locatorStr = 'main div[role="grid"] a[href*="/p/"], main div[role="grid"] a[href*="/reel/"]';
          items = page.locator(locatorStr);
          await items.first().waitFor({ state: 'visible', timeout: 60_000 });
        } catch {
          throw e;
        }
      } else {
        throw e;
      }
    }

    // Auto-scroll to load more tiles until reaching limit or stalling
    let prevCount = 0;
    let stagnant = 0;
    for (let attempt = 0; attempt < 50; attempt++) {
      const countNow = await items.count();
      if (countNow >= limit) break;
      if (countNow === prevCount) stagnant++;
      else stagnant = 0;
      if (stagnant >= 8) break;
      prevCount = countNow;
      // Scroll container/page depending on platform
      await page.evaluate(() => {
        const el = document.scrollingElement || document.documentElement;
        el.scrollBy(0, Math.max(1200, Math.floor(window.innerHeight * 1.75)));
      });
      // Also send PageDown/End to trigger loading
      await page.keyboard.press('PageDown').catch(() => {});
      if (attempt % 5 === 4) {
        await page.keyboard.press('End').catch(() => {});
      }
      // Recompute items in case DOM changed (IG often re-renders)
      items = page.locator(locatorStr);
      await page.waitForTimeout(1200);
      await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => {});
    }
    const count = Math.min(await items.count(), limit);
    for (let i = 0; i < count; i++) {
      const loc = items.nth(i);
      await loc.scrollIntoViewIfNeeded();
      const file = path.join(destDir, `${platform}-shot-${i + 1}.png`);
      await loc.screenshot({ path: file });
      outputs.push(file);
    }
  } finally {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }
  return outputs;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error('Usage: node generate-batch-accounts.js <accountUrl1> <accountUrl2> ...');
    process.exit(1);
  }

  // Prepare IO dirs
  const cwd = process.cwd();
  const testDataDir = path.join(cwd, 'test-data');
  const background = path.join(testDataDir, 'background.mp4');
  const bgm = path.join(testDataDir, 'bgm.mp3');
  const outRoot = path.join(cwd, 'test-results', `batch-${Date.now()}`);
  mkdirSync(outRoot, { recursive: true });

  // Check optional assets
  const hasBgm = await fs.access(bgm).then(() => true).catch(() => false);
  if (!hasBgm) {
    console.warn('[batch] bgm.mp3 not found under test-data. Proceeding without BGM.');
  }

  const baseSettings: AppSettings = {
    general: { outputPath: outRoot },
    platforms: {
      x: { enabled: false, accounts: [], intervalMinutes: 15, scrapeDelayMs: 0 },
      tiktok: { enabled: false, accounts: [], intervalMinutes: 15, scrapeDelayMs: 0 },
      instagram: { enabled: false, accounts: [], intervalMinutes: 15, scrapeDelayMs: 0 },
      youtube: { enabled: false, accounts: [], intervalMinutes: 15, scrapeDelayMs: 0 },
    },
    render: {
      resolution: { width: 1080, height: 1920 },
      durationSec: 10,
      bgmPath: hasBgm ? bgm : '',
      backgroundVideoPath: background,
      captions: { top: '', bottom: '' },
      scale: 0.85,
      teleTextBg: '#000000',
      qualityPreset: 'standard',
      overlayPosition: 'center',
      topCaptionHeight: 120,
      bottomCaptionHeight: 160,
      captionBgOpacity: 1,
    },
  };

  const tasks: Array<Promise<void>> = [];
  for (const rawUrl of args) {
    const acc = detectPlatformAndAccount(rawUrl);
    if (!acc) {
      console.error('Skip (unrecognized):', rawUrl);
      continue;
    }
    const accOutDir = path.join(outRoot, `${acc.platform}-${acc.accountId}`);
    await ensureDir(accOutDir);

    if (acc.platform === 'x') {
      // X: collect screenshots for first 15 posts
      tasks.push((async () => {
        const shots = await collectXScreenshots(rawUrl, 15, accOutDir);
        let idx = 0;
        for (const ss of shots) {
          const settings: AppSettings = {
            ...baseSettings,
            render: {
              ...baseSettings.render,
              captions: { top: `X #${++idx}`, bottom: acc.accountId },
            },
          } as AppSettings;
          try {
            const out = await generateVideo(ss, settings);
            console.log('[X] out:', out);
          } catch (e) {
            console.error('[X] generate failed:', (e as Error)?.message || String(e));
          }
        }
      })());
    } else {
      // Others: fetch recent 15 video page URLs, download, then render. Fallback to screenshots if listing fails.
      tasks.push((async () => {
        let pages: string[] = [];
        try {
          pages = await collectYouTubeTikTokInstagram(rawUrl, 15);
        } catch (e) {
          console.error(`[${acc.platform}] list failed:`, (e as Error)?.message || String(e));
          // Fallback: try screenshots of tiles
          try {
            const shots = await collectGenericScreenshots(rawUrl, 15, accOutDir, acc.platform as 'tiktok'|'instagram'|'youtube');
            let idx = 0;
            for (const ss of shots) {
              const settings: AppSettings = {
                ...baseSettings,
                render: {
                  ...baseSettings.render,
                  captions: { top: `${acc.platform.toUpperCase()} #${++idx}`, bottom: acc.accountId },
                },
              } as AppSettings;
              try {
                const out = await generateVideo(ss, settings);
                console.log(`[${acc.platform}] (fallback screenshot) out:`, out);
              } catch (e2) {
                console.error(`[${acc.platform}] fallback generate failed:`, (e2 as Error)?.message || String(e2));
              }
            }
          } catch (e2) {
            console.error(`[${acc.platform}] fallback screenshots failed:`, (e2 as Error)?.message || String(e2));
          }
          return;
        }
        let idx = 0;
        for (const pageUrl of pages) {
          try {
            const file = await downloadVideo(pageUrl, path.join(accOutDir, 'downloads'));
            const settings: AppSettings = {
              ...baseSettings,
              render: {
                ...baseSettings.render,
                captions: { top: `${acc.platform.toUpperCase()} #${++idx}`, bottom: acc.accountId },
              },
            } as AppSettings;
            const out = await generateVideo('', settings, file);
            console.log(`[${acc.platform}] out:`, out);
          } catch (e) {
            console.error(`[${acc.platform}] generate failed:`, (e as Error)?.message || String(e));
          }
        }
      })());
    }
  }

  // Run tasks in parallel but avoid overwhelming network/CPU: cap concurrency
  const concurrency = Math.max(1, Math.min(4, Number(process.env.CONCURRENCY || '2')));
  const queue = tasks.slice();
  const runners: Array<Promise<void>> = [];
  for (let i = 0; i < concurrency; i++) {
    runners.push((async () => {
      while (queue.length) {
        const t = queue.shift();
        if (!t) break;
        await t.catch(() => {});
      }
    })());
  }
  await Promise.all(runners);

  console.log('Done. Outputs under:', outRoot);
}

main().catch((e) => {
  console.error('Batch failed:', (e as Error)?.message || String(e));
  process.exit(1);
});
