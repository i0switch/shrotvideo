import path from 'node:path';
import fs from 'node:fs/promises';
import log from 'electron-log';
import ffmpegStatic from 'ffmpeg-static';
import ffmpeg from 'fluent-ffmpeg';

export type MediaBox = { x: number; y: number; width: number; height: number };

export type TweetClassification = 'single_video' | 'multi_video' | 'image' | 'text';

function sanitizeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_.-]+/g, '_').slice(0, 140);
}

export async function captureTweetScreenshotAndBox(url: string, outDir: string): Promise<{ screenshotPath: string; relBox?: MediaBox; tweetId?: string; classification: TweetClassification } | null> {
  // Playwright は本番バンドルに含めないため、開発/同梱環境のみ有効。失敗時は null。
  let playwright: any;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    playwright = require('playwright');
  } catch {
    log.warn('[x-composer] playwright not available; skip capture.');
    return null;
  }

  await fs.mkdir(outDir, { recursive: true }).catch(() => undefined);

  const { chromium } = playwright as typeof import('playwright');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    deviceScaleFactor: 1,
    locale: 'ja-JP',
    colorScheme: 'light',
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36',
  });
  const page = await context.newPage();
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForLoadState('networkidle').catch(() => undefined);
    await page.waitForSelector('article[role="article"]', { timeout: 30000 });

    // 記事と子video/imgの矩形とtweetIdを評価
    const info = await page.evaluate(() => {
      const art = document.querySelector('article[role="article"]') as HTMLElement | null;
      const rectA = art?.getBoundingClientRect();
      const videos = art ? Array.from(art.querySelectorAll('video')) as HTMLVideoElement[] : [];
      const images = art ? Array.from(art.querySelectorAll('img')) as HTMLImageElement[] : [];
      const vRects = videos.map(v => v.getBoundingClientRect());
      const iCount = images.length;
      const vCount = videos.length;
      let classification: 'single_video' | 'multi_video' | 'image' | 'text' = 'text';
      if (vCount > 0) classification = vCount === 1 ? 'single_video' : 'multi_video';
      else if (iCount > 0) classification = 'image';
      const link = art?.querySelector('a[href*="/status/"]') as HTMLAnchorElement | null;
      const m = link?.href?.match(/\/status\/(\d+)/);
      const tweetId = m ? m[1] : undefined;
      return {
        a: rectA ? { x: rectA.x, y: rectA.y, width: rectA.width, height: rectA.height } : null,
        v: vRects.map(r => ({ x: r.x, y: r.y, width: r.width, height: r.height })),
        classification,
        tweetId,
      };
    });

    // 記事スクショ
    const locator = page.locator('article[role="article"]');
    const el = await locator.elementHandle();
    const ts = Date.now();
    const base = sanitizeFileName(`xshot-${info?.tweetId || 'post'}-${ts}`);
    const screenshotPath = path.join(outDir, `${base}.png`);
    if (el) {
      await (await el.screenshot({ path: screenshotPath, animations: 'disabled' }));
    } else {
      // 記事が取れない場合は全画面
      await page.screenshot({ path: screenshotPath, fullPage: true });
    }

    // 動画領域の相対座標（記事矩形基準）
    let relBox: MediaBox | undefined;
    if (info?.a && Array.isArray(info?.v) && info.v.length > 0) {
      const v0 = info.v[0];
      relBox = { x: v0.x - info.a.x, y: v0.y - info.a.y, width: v0.width, height: v0.height };
    }

    return { screenshotPath, relBox, tweetId: info?.tweetId, classification: info?.classification || 'text' };
  } catch (e) {
    log.warn('[x-composer] capture failed:', (e as Error)?.message || String(e));
    return null;
  } finally {
    await browser.close().catch(() => undefined);
  }
}

export async function overlayVideoOnScreenshot(params: {
  screenshotPath: string;
  videoPath: string;
  box: MediaBox;
  outputDir: string;
  fileName?: string;
}): Promise<string> {
  const { screenshotPath, videoPath, box, outputDir } = params;
  await fs.mkdir(outputDir, { recursive: true }).catch(() => undefined);
  const outName = sanitizeFileName(params.fileName || `x-compose-${Date.now()}.mp4`);
  const outputPath = path.join(outputDir, outName);

  // ffmpeg 実行パス設定
  try { if (ffmpegStatic) ffmpeg.setFfmpegPath(ffmpegStatic as unknown as string); } catch {}

  const x = Math.max(0, Math.round(box.x));
  const y = Math.max(0, Math.round(box.y));
  const w = Math.max(2, Math.round(box.width));
  const h = Math.max(2, Math.round(box.height));

  log.info('[x-composer] overlay start', { outputPath, x, y, w, h });

  const run = (permissive: boolean) => new Promise<void>((resolve, reject) => {
    const cmd = ffmpeg();
    cmd.input(screenshotPath).inputOptions(['-loop 1', '-framerate 30']);
    cmd.input(videoPath);
    if (!permissive) {
      cmd
        .complexFilter([
          `[0:v]scale=trunc(iw/2)*2:trunc(ih/2)*2,format=rgba[bg]`,
          `[1:v]scale=${w}:${h}:force_original_aspect_ratio=decrease:force_divisible_by=2,setsar=1,format=yuv420p[vid]`,
          `[bg][vid]overlay=${x}:${y}:eval=init:shortest=1[outv]`,
        ])
        .outputOptions([
          '-map [outv]',
          '-map 1:a?',
          '-c:v libx264',
          '-c:a aac',
          '-pix_fmt yuv420p',
          '-vsync 2',
          '-shortest',
          '-movflags +faststart',
          '-preset veryfast',
        ]);
    } else {
      cmd
        .complexFilter([
          `[0:v]scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p[bg]`,
          `[1:v][bg]scale2ref=w=${w}:h=${h}[vid][bgr]`,
          `[bgr][vid]overlay=${x}:${y}:eval=init:shortest=1[outv]`,
        ])
        .outputOptions([
          '-map [outv]',
          '-map 1:a?',
          '-c:v libx264',
          '-c:a aac',
          '-pix_fmt yuv420p',
          '-vsync 2',
          '-shortest',
          '-movflags +faststart',
          '-preset veryfast',
        ]);
    }
    cmd
      .save(outputPath)
      .on('end', () => resolve())
      .on('error', (err: Error) => reject(err));
  });

  try {
    await run(false);
  } catch (e1) {
    log.warn('[x-composer] primary overlay failed; retry permissive', (e1 as Error)?.message || String(e1));
    await run(true);
  }

  log.info('[x-composer] overlay done', { outputPath });
  return outputPath;
}
