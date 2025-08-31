'use strict';

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { chromium } = require('playwright');

async function ensureDir(p) {
  await fsp.mkdir(p, { recursive: true }).catch(() => {});
  return p;
}

function parseArgs() {
  const args = process.argv.slice(2);
  const out = {};
  for (const a of args) {
    const m = a.match(/^(\w+)=(.*)$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

async function main() {
  const a = parseArgs();
  const account = (process.env.CAPTURE_X_ACCOUNT || a.account || '').trim();
  const limit = Math.max(1, Math.min(10, Number(process.env.CAPTURE_X_LIMIT || a.limit || 5)));
  if (!account) {
    console.error('[capture-x] Missing account. Set CAPTURE_X_ACCOUNT or pass account=<id>');
    process.exit(1);
  }

  const ts = Date.now();
  const baseRaw = (process.env.CAPTURE_OUT_BASE || a.outBase || 'test-results/auto-screenshots').trim();
  const outDir = path.isAbsolute(baseRaw)
    ? path.join(baseRaw, `${account}-${ts}`)
    : path.join(process.cwd(), baseRaw, `${account}-${ts}`);
  await ensureDir(outDir);

  console.log(`[capture-x] Start account=${account} limit=${limit} out=${outDir}`);
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36'
  });
  const page = await ctx.newPage();
  page.on('console', (msg) => {
    try { console.log('[page]', msg.type(), msg.text()); } catch {}
  });

  const url = `https://x.com/${account}`;
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });

  // Wait for at least one article or timeout
  try {
    await page.waitForSelector('article[role="article"]', { timeout: 25000 });
  } catch {}

  // Prefetch more posts by scrolling
  const need = Math.max(limit + 4, limit * 2);
  for (let i = 0; i < 20; i++) {
    const count = await page.locator('article[role="article"]').count();
    if (count >= need) break;
    await page.mouse.wheel(0, 800);
    await page.waitForTimeout(400);
  }

  // Hide bottom fixed nav and per-article action groups
  await page.evaluate(() => {
    try {
      document.querySelectorAll('article [role="group"]').forEach((el) => (el.style.visibility = 'hidden'));
      const els = Array.from(document.querySelectorAll('*'));
      for (const el of els) {
        try {
          const cs = getComputedStyle(el);
          const bottom = parseFloat(cs.bottom || 'NaN');
          if (cs.position === 'fixed' && !Number.isNaN(bottom) && bottom >= -2 && bottom < 120) {
            el.style.visibility = 'hidden';
          }
        } catch {}
      }
    } catch {}
  });

  const arts = await page.locator('article[role="article"]').all();
  const results = [];
  for (let i = 0; i < arts.length && results.length < limit; i++) {
    const aLoc = arts[i];
    try {
      // Derive an id/url if present
      const href = await aLoc.locator('time').locator('xpath=ancestor::a[1]').getAttribute('href').catch(() => null);
      const id = href ? new URL(href, 'https://x.com').toString() : `post-${i+1}`;
      await aLoc.scrollIntoViewIfNeeded();
      await page.waitForTimeout(200);
      // Screenshot element (actions hidden above)
      const name = `${String(results.length+1).padStart(2,'0')}-${String(id).replace(/[^\w-]+/g,'-').slice(0,64)}.png`;
      const dest = path.join(outDir, name);
      await aLoc.screenshot({ path: dest });
      const stat = fs.existsSync(dest) ? fs.statSync(dest) : null;
      if (!stat || stat.size === 0) {
        // fallback full page clip to element bounding box
        const box = await aLoc.boundingBox();
        if (box) {
          await page.screenshot({ path: dest, clip: box });
        }
      }
      results.push({ id, path: dest });
    } catch (e) {
      console.warn('[capture-x] Failed one article:', e?.message || String(e));
    }
  }

  await fsp.writeFile(path.join(outDir, 'summary.json'), JSON.stringify(results, null, 2), 'utf8').catch(() => {});
  console.log(`[capture-x] Done. Saved ${results.length} file(s) to ${outDir}`);
  await browser.close();
}

main().catch((e) => {
  console.error('[capture-x] fatal:', e?.stack || e?.message || String(e));
  process.exit(1);
});
