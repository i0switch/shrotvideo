// Dynamic import to avoid hard compile dependency on 'playwright' types
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

export type PXItem = { id: string; path: string; url?: string; textHash?: string };

async function ensureDir(p: string) {
  await fsp.mkdir(p, { recursive: true }).catch(() => {});
  return p;
}

async function takePostScreenshots(page: any, user: string, count: number, outDir: string): Promise<PXItem[]> {
  const targetUser = user.startsWith('@') ? user.substring(1) : user;
  await page.goto(`https://x.com/${targetUser}`);
  await page.waitForSelector('article[role="article"]');

  const outputDirForUser = path.join(outDir, targetUser);
  await ensureDir(outputDirForUser);

  const results: PXItem[] = [];
  const seen = new Set<string>();

  while (results.length < count) {
    const articles = await page.locator('article[role="article"]').all();
    for (const article of articles) {
      if (results.length >= count) break;

      const tweetLink = await article.locator('a[href*="/status/"]').first();
      const href = await tweetLink.getAttribute('href');
      if (!href) continue;
      const m = href.match(/\/status\/(\d+)/);
      const tweetId = m ? m[1] : null;
      if (!tweetId || seen.has(tweetId)) continue;

      const tweetTextElement = await article.locator('[data-testid="tweetText"]');
      const tweetText = (await tweetTextElement.textContent()) || '';
      const textHash = createHash('sha256').update(tweetText).digest('hex');

      const now = new Date().toISOString().replace(/[:.]/g, '-');
      const safeId = `${now}_${tweetId}_${String(results.length + 1)}`;
      const filePath = path.join(outputDirForUser, `${safeId}.png`);

      await article.screenshot({ path: filePath, animations: 'disabled' });
      // minimal metadata sidecar
      try {
        await fsp.writeFile(path.join(outputDirForUser, `${safeId}.json`), JSON.stringify({ tweetId, text: tweetText, textHash }, null, 2), 'utf8');
      } catch {}

      results.push({ id: tweetId, path: filePath, url: new URL(href, 'https://x.com').toString(), textHash });
      seen.add(tweetId);
    }
    if (results.length < count) {
      const lastArticle = await page.locator('article[role="article"]').last();
      await lastArticle.scrollIntoViewIfNeeded();
      await page.waitForTimeout(1200);
    }
  }
  return results;
}

/**
 * Capture latest X posts screenshots using Playwright.
 * If a login storage exists under screenshot/.auth/x.storage.json, use it; otherwise proceed unauthenticated.
 */
export async function captureXPostsPlaywright(user: string, count: number, outDir: string): Promise<PXItem[]> {
  await ensureDir(outDir);
  // Try to reuse storage from bundled screenshot backend if present
  const storageStatePath = path.join(process.cwd(), 'screenshot', '.auth', 'x.storage.json');
  const hasStorage = fs.existsSync(storageStatePath);
  // Prefer full playwright, but fallback to playwright-core in packaged runtime
  let chromium: any;
  try {
    chromium = (await import('playwright')).chromium;
  } catch {
    chromium = (await import('playwright-core')).chromium as any;
  }
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
    const items = await takePostScreenshots(page, user, count, outDir);
    return items;
  } finally {
    await browser.close();
  }
}
