'use strict';

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { createHash } = require('crypto');
// Auto set PLAYWRIGHT_BROWSERS_PATH when running inside packaged electron resources
if (!process.env.PLAYWRIGHT_BROWSERS_PATH && process.resourcesPath) {
  const p = require('path');
  process.env.PLAYWRIGHT_BROWSERS_PATH = p.join(process.resourcesPath, 'playwright_browsers');
}
const { chromium } = require('playwright-core');

async function ensureDir(p) {
  await fsp.mkdir(p, { recursive: true }).catch(() => {});
  return p;
}

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

async function takePostScreenshots(page, user, count, outDir) {
  const targetUser = user.startsWith('@') ? user.substring(1) : user;
  await page.goto(`https://x.com/${targetUser}`);
  await page.waitForSelector('article[role="article"]');
  const outputDirForUser = path.join(outDir, targetUser);
  await ensureDir(outputDirForUser);

  const seen = new Set();
  let captured = 0;
  while (captured < count) {
    const articles = await page.locator('article[role="article"]').all();
    for (const article of articles) {
      if (captured >= count) break;
      const tweetLink = await article.locator('a[href*="/status/"]').first();
      const href = await tweetLink.getAttribute('href');
      if (!href) continue;
      const m = href.match(/\/status\/(\d+)/);
      const tweetId = m ? m[1] : null;
      if (!tweetId || seen.has(tweetId)) continue;
  // 一部記事でtweetTextが複数要素に一致するため strict 違反を避ける
  const tweetTextElement = await article.locator('[data-testid="tweetText"]').first();
  const tweetText = (await tweetTextElement.textContent()) || '';
      const textHash = createHash('sha256').update(tweetText).digest('hex');
      const now = new Date().toISOString().replace(/[:.]/g, '-');
      const base = `${now}_${tweetId}_${captured + 1}`;
      const png = path.join(outputDirForUser, `${base}.png`);
      const meta = path.join(outputDirForUser, `${base}.json`);
      await article.screenshot({ path: png, animations: 'disabled' });
      await fsp.writeFile(meta, JSON.stringify({ tweetId, text: tweetText, textHash }, null, 2), 'utf8').catch(() => {});
      seen.add(tweetId);
      captured++;
    }
    if (captured < count) {
      const lastArticle = await page.locator('article[role="article"]').last();
      await lastArticle.scrollIntoViewIfNeeded();
      await page.waitForTimeout(1200);
    }
  }
}

async function main() {
  const args = parseArgs(process.argv);
  const user = args.user || process.env.USER || '';
  const count = Math.max(1, Math.min(10, Number(args.count || process.env.COUNT || 5)));
  const outDir = args.outDir || process.env.OUT_DIR || path.join(process.cwd(), 'test-results', 'auto-screenshots');
  if (!user) {
    console.error('[run-screenshot-grab] Missing --user');
    process.exit(1);
  }
  await ensureDir(outDir);
  const storageStatePath = path.join(process.cwd(), 'screenshot', '.auth', 'x.storage.json');
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
  main().catch((e) => { console.error('[run-screenshot-grab] fatal:', e?.message || String(e)); process.exit(1); });
}
