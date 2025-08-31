import { chromium, Page } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';

// --- Core Logic separated from browser management ---

interface TakeScreenshotsOptions {
  user: string;
  count: number;
  outDir: string;
}

/**
 * The core logic for taking screenshots of posts using an existing Page object.
 */
export async function takePostScreenshots(page: Page, options: TakeScreenshotsOptions) {
  const { user, count, outDir } = options;
  const targetUser = user.startsWith('@') ? user.substring(1) : user;

  await page.goto(`https://x.com/${targetUser}`);
  await page.waitForSelector('article[role="article"]');

  console.log(`Grabbing latest ${count} posts from @${targetUser}...`);

  const outputDirForUser = path.join(outDir, targetUser);
  fs.mkdirSync(outputDirForUser, { recursive: true });

  let capturedCount = 0;
  const capturedTweetIds = new Set<string>();

  while (capturedCount < count) {
    const articles = await page.locator('article[role="article"]').all();

    for (const article of articles) {
      if (capturedCount >= count) break;

      const tweetLink = await article.locator('a[href*="/status/"]').first();
      const href = await tweetLink.getAttribute('href');
      if (!href) continue;

      const tweetIdMatch = href.match(/\/status\/(\d+)/);
      const tweetId = tweetIdMatch ? tweetIdMatch[1] : null;
      if (!tweetId || capturedTweetIds.has(tweetId)) continue;

      const tweetTextElement = await article.locator('[data-testid="tweetText"]');
      const tweetText = (await tweetTextElement.textContent()) || '';
      const textHash = createHash('sha256').update(tweetText).digest('hex');

      const metadata = { tweetId, text: tweetText, textHash };
      const now = new Date().toISOString().replace(/[:.]/g, '-');
      const baseFilename = `${now}_${tweetId}_${capturedCount + 1}`;
      const screenshotPath = path.join(outputDirForUser, `${baseFilename}.png`);
      const metaPath = path.join(outputDirForUser, `${baseFilename}.json`);

      await article.screenshot({ path: screenshotPath, animations: 'disabled' });
      fs.writeFileSync(metaPath, JSON.stringify(metadata, null, 2));

      console.log(`[${capturedCount + 1}/${count}] Saved screenshot and metadata: ${screenshotPath}`);
      capturedTweetIds.add(tweetId);
      capturedCount++;
    }

    if (capturedCount < count) {
      console.log('Scrolling down to load more posts...');
      const lastArticle = await page.locator('article[role="article"]').last();
      await lastArticle.scrollIntoViewIfNeeded();
      await page.waitForTimeout(2000);
    }
  }
  console.log('Successfully captured all posts.');
}

// --- CLI-specific wrapper --- 

interface GrabOptions {
  user: string;
  count: number;
  outDir: string;
  storageStatePath: string;
}

/**
 * CLI wrapper: Manages browser instance and calls the core screenshot logic.
 */
export async function grabLatestPosts(options: GrabOptions): Promise<void> {
  const { storageStatePath } = options;
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ 
    storageState: storageStatePath,
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
    locale: 'ja-JP',
    colorScheme: 'light',
  });
  const page = await context.newPage();

  try {
    await takePostScreenshots(page, options);
  } catch (error) {
    console.error('Failed to grab posts:', error);
  } finally {
    await browser.close();
  }
}
