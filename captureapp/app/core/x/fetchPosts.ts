import { Page } from 'playwright';
import { createLogger } from '@core/logging/logger';
import { PostTarget } from '@core/types';

const logger = createLogger('fetchPosts');
const SCROLL_DELAY_MS = 800;
const MAX_SCROLL_ATTEMPTS = 20;

export async function fetchLatestPosts(page: Page, handle: string, count: number): Promise<PostTarget[]> {
  const profileUrl = `https://x.com/${handle}`;
  logger.info('Navigating to profile', profileUrl);
  await page.goto(profileUrl, { waitUntil: 'networkidle' });

  await page.waitForSelector('article a[href*="/status/"]');

  const collectPosts = async (): Promise<PostTarget[]> =>
    page.evaluate<PostTarget[], number>((max) => {
      const linkElements = Array.from(document.querySelectorAll<HTMLAnchorElement>('article a[href*="/status/"]'));
      const unique = new Map<string, string>();
      for (const link of linkElements) {
        const href = link.href;
        if (href.includes('/analytics')) {
          continue;
        }
        const match = href.match(/status\/(\d+)/);
        if (match) {
          unique.set(match[1], href);
        }
        if (unique.size >= max) {
          break;
        }
      }
      return Array.from(unique.entries()).map(([tweetId, url]) => ({ tweetId, url }));
    }, count);

  let posts = await collectPosts();
  let attempts = 0;

  while (posts.length < count && attempts < MAX_SCROLL_ATTEMPTS) {
    attempts += 1;
    logger.info('Scrolling for more posts', { attempts, current: posts.length, target: count });
    await page.evaluate(() => {
      window.scrollBy({ top: window.innerHeight * 0.9, behavior: 'smooth' });
    });
    await page.waitForTimeout(SCROLL_DELAY_MS);
    posts = await collectPosts();
  }

  logger.info('Collected posts', { total: posts.length, attempts });
  return posts.slice(0, count);
}
