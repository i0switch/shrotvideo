import log from 'electron-log';
import type { AppSettings, Platform } from '../../src/core/settings';
import { chromium } from 'playwright';
import { app } from 'electron';
import path from 'path';

export type ScrapeResult = { type: 'screenshot', path: string } | { type: 'video_url', url: string };

function getPlatformUrl(platform: Platform, accountId: string): string {
  switch (platform) {
    case 'x':
      return `https://x.com/${accountId}`;
    case 'tiktok':
      return `https://www.tiktok.com/@${accountId}`;
    case 'instagram':
      return `https://www.instagram.com/${accountId}`;
    case 'youtube':
      return `https://www.youtube.com/@${accountId}`;
    default:
      throw new Error(`Unsupported platform: ${platform}`);
  }
}

async function scrapeX(accountId: string): Promise<string | null> {
  log.info(`[x:${accountId}] Starting Playwright scrape...`);
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  try {
    const url = getPlatformUrl('x', accountId);
    await page.goto(url, { waitUntil: 'networkidle' });

    // Wait for the main timeline to be visible
    await page.waitForSelector('section[role="region"] div[data-testid="cellInnerDiv"]');

    // Find the first retweet. This selector is brittle and likely to change.
    // It looks for a div that contains the "reposted" text.
    const retweetLocator = page.locator('div[data-testid="cellInnerDiv"]:has-text("reposted")').first();

    if (await retweetLocator.count() === 0) {
      log.warn(`[x:${accountId}] No retweets found on the page.`);
      return null;
    }

    const screenshotPath = path.join(app.getPath('temp'), `screenshot-x-${accountId}-${Date.now()}.png`);
    await retweetLocator.screenshot({ path: screenshotPath });

    log.info(`[x:${accountId}] Screenshot taken successfully: ${screenshotPath}`);
    return screenshotPath;

  } catch (error: any) {
    log.error(`[x:${accountId}] Playwright scraping failed:`, error.message);
    return null;
  } finally {
    await browser.close();
  }
}

export async function scrapeAccount(
  platform: Platform,
  accountId: string,
  settings: AppSettings,
): Promise<ScrapeResult | null> {
  log.info(`[${platform}:${accountId}] Starting scrape...`);

  if (platform === 'tiktok' || platform === 'youtube' || platform === 'instagram') {
    const accountUrl = getPlatformUrl(platform, accountId);
    try {
      log.info(`[${platform}:${accountId}] Using yt-dlp to get latest video URL from ${accountUrl}`);
      // Dynamically import the ESM ytdlp-nodejs module
      const ytdlp = (await import('ytdlp-nodejs')).default;
      // @ts-ignore - The types for this module seem to be incorrect, causing a build failure.
      const video = await ytdlp(accountUrl, {
        dumpSingleJson: true,
        playlistItems: '1',
      });

      const url = video.url || (video as any).webpage_url;
      if (url) {
        log.info(`[${platform}:${accountId}] Found video URL: ${url}`);
        return { type: 'video_url', url };
      } else {
         log.warn(`[${platform}:${accountId}] yt-dlp did not return a usable URL.`);
         return null;
      }
    } catch (error: any) {
      log.error(`[${platform}:${accountId}] yt-dlp failed:`, error.message);
      return null;
    }
  }

  if (platform === 'x') {
    const screenshotPath = await scrapeX(accountId);
    if (screenshotPath) {
      return { type: 'screenshot', path: screenshotPath };
    }
    return null;
  }

  return null;
}
