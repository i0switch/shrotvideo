'use strict';

// Lightweight CLI to grab X post screenshots into screenshot/out/screenshots/<user>
// Usage: ELECTRON_RUN_AS_NODE=1 <electron exe> screenshot/bin/grab.cjs --user <x_account> --count <n> [--outDir <dir>]

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { createHash } = require('crypto');

// Use playwright-core (browsers supplied via PLAYWRIGHT_BROWSERS_PATH)
const { chromium } = require('playwright-core');

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    const m1 = a.match(/^--(\w+?)=(.*)$/);
    if (m1) { out[m1[1]] = m1[2]; continue; }
    const m2 = a.match(/^--(\w+)$/);
    if (m2 && argv[i+1] && !argv[i+1].startsWith('--')) { out[m2[1]] = argv[i+1]; i++; continue; }
  }
  return out;
}

async function ensureDir(p) {
  await fsp.mkdir(p, { recursive: true }).catch(() => {});
  return p;
}

async function takePostScreenshots(page, user, count, outDir) {
  const targetUser = user.startsWith('@') ? user.substring(1) : user;
  await page.goto(`https://x.com/${targetUser}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForSelector('article[role="article"]', { timeout: 30000 }).catch(() => {});

  const outputDirForUser = path.join(outDir, targetUser);
  await ensureDir(outputDirForUser);

  const seen = new Set();
  let captured = 0;
  const maxLoops = Math.max(count * 3, 10);
  for (let loop = 0; loop < maxLoops && captured < count; loop++) {
    const articles = await page.locator('article[role="article"]').all();
    for (const article of articles) {
      if (captured >= count) break;
      const link = article.locator('a[href*="/status/"]').first();
      const href = await link.getAttribute('href').catch(() => null);
      const m = href && href.match(/\/status\/(\d+)/);
      const tweetId = m ? m[1] : null;
      if (!tweetId || seen.has(tweetId)) continue;
  // tweetText ロケータは複数要素に一致する場合があるので first() でstrict違反を回避
  const tweetTextEl = article.locator('[data-testid="tweetText"]').first();
  const tweetText = (await tweetTextEl.textContent().catch(() => '')) || '';
      const textHash = createHash('sha256').update(tweetText).digest('hex');
      const base = `xshot-${targetUser}-${tweetId}-${Date.now()}`;
      const png = path.join(outputDirForUser, `${base}.png`);
      const meta = path.join(outputDirForUser, `${base}.json`);
      try {
        await article.screenshot({ path: png, animations: 'disabled' });
        await fsp.writeFile(meta, JSON.stringify({ tweetId, href: href ? new URL(href, 'https://x.com').toString() : undefined, textHash }, null, 2), 'utf8').catch(() => {});
        seen.add(tweetId);
        captured++;
      } catch {
        // ignore one failure and continue
      }
    }
    if (captured < count) {
      const last = await page.locator('article[role="article"]').last();
      await last.scrollIntoViewIfNeeded().catch(() => {});
      await page.waitForTimeout(1200);
    }
  }
}

async function main() {
  const args = parseArgs(process.argv);
  const user = args.user || process.env.USER || '';
  const count = Math.max(1, Math.min(20, Number(args.count || process.env.COUNT || 3)));
  const BASE = path.resolve(__dirname, '..');
  const DEFAULT_OUT = path.join(BASE, 'out', 'screenshots');
  const outDir = args.outDir || process.env.OUT_DIR || DEFAULT_OUT;
  if (!user) {
    console.error('[screenshot:grab] Missing --user');
    process.exit(2);
  }
  await ensureDir(outDir);

  const storageStatePath = path.join(BASE, '.auth', 'x.storage.json');
  const hasStorage = fs.existsSync(storageStatePath);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    storageState: hasStorage ? storageStatePath : undefined,
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
    locale: 'ja-JP',
    colorScheme: 'light',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36',
  });
  const page = await context.newPage();
  try {
    await takePostScreenshots(page, user, count, outDir);
  } finally {
    await browser.close();
  }
}

if (require.main === module) {
  main().catch((e) => { console.error('[screenshot:grab] fatal:', e?.message || String(e)); process.exit(1); });
}
