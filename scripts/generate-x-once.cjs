/*
  Node script: generate one X-based short video.
  Usage (PowerShell):
    $env:URL_X='<x_post_url>'; node scripts/generate-x-once.cjs
*/
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { chromium } = require('playwright');

const { generateVideo } = require(path.join(process.cwd(), 'dist', 'electron', 'electron', 'tasks', 'video-generator.js'));

function ensureDir(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

async function captureXScreenshot(postUrl, destPath) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1200, height: 2000 } });
  const page = await context.newPage();
  try {
    await page.goto(postUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});
    const article = page.locator('article[role="article"]').first();
    await article.waitFor({ state: 'visible', timeout: 30_000 });
    await article.screenshot({ path: destPath });
    return true;
  } catch (e) {
    console.error('X screenshot failed:', e && e.message ? e.message : String(e));
    try {
      await page.screenshot({ path: destPath, fullPage: true });
      return true;
    } catch { return false; }
  } finally {
    await context.close();
    await browser.close();
  }
}

(async () => {
  const argUrl = process.argv.find((a) => a.startsWith('--url='));
  const url = argUrl ? argUrl.slice('--url='.length) : (process.env.URL_X || 'https://x.com/Mountain_cb/status/1828090171736930560');
  const outRoot = path.join(process.cwd(), 'output', 'x');
  const tmp = path.join(os.tmpdir(), 'svt_x_once');
  ensureDir(outRoot);
  ensureDir(tmp);

  const bg = path.join(process.cwd(), 'test-data', 'background.mp4');
  if (!fs.existsSync(bg)) {
    console.error('Missing background video:', bg);
    process.exit(1);
  }

  const ssPath = path.join(tmp, `xshot-${Date.now()}.png`);
  const ok = await captureXScreenshot(url, ssPath);
  if (!ok) {
    console.error('Failed to capture X screenshot');
    process.exit(2);
  }

  /** @type {import('../src/core/settings').AppSettings} */
  const settings = {
    general: { outputPath: outRoot },
    platforms: { x: { enabled: false, accounts: [], intervalMinutes: 15, scrapeDelayMs: 0 }, tiktok: { enabled: false, accounts: [], intervalMinutes: 15, scrapeDelayMs: 0 }, youtube: { enabled: false, accounts: [], intervalMinutes: 15, scrapeDelayMs: 0 } },
    render: {
      resolution: { width: 1080, height: 1920 },
      durationSec: 10,
      backgroundVideoPath: bg,
      captions: { top: 'X', bottom: new URL(url).pathname.split('/').pop() || '' },
      scale: 0.9,
      teleTextBg: '#000000',
      captionBgOpacity: 1,
      overlayPosition: 'center',
      qualityPreset: 'standard'
    }
  };

  console.log('Generating… URL_X=', url);
  const out = await generateVideo(ssPath, settings, undefined, { forceDuration: true });
  console.log('Output:', out);
})();
