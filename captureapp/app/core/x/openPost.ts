import { Page } from 'playwright';
import { createLogger } from '@core/logging/logger';

const logger = createLogger('openPost');

export async function openPost(page: Page, url: string) {
  logger.info('Opening post', url);
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForSelector('article[role="article"]');
}
