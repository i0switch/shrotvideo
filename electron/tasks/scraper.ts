import { chromium, Page, BrowserContext } from 'playwright'; // Add BrowserContext
import { app } from 'electron';
import path from 'path';
import log from 'electron-log';
import type { AppSettings, Platform } from '../../src/core/settings.js';
import * as keytar from 'keytar'; // Add keytar import
import * as fs from 'fs/promises'; // For file system operations

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

// New: Function to get service name for keytar
function getService(platform: Platform): string {
  return `com.gemini.shortvideotool.${platform}`;
}

// New: Login function
async function loginToPlatform(
  platform: Platform,
  username: string,
  password: string,
  context: BrowserContext
): Promise<void> {
  log.info(`[${platform}:${username}] Attempting to log in...`);
  const page = await context.newPage();

  try {
    switch (platform) {
      case 'x':
        await page.goto('https://x.com/i/flow/login', { waitUntil: 'networkidle', timeout: 30000 });
        await page.waitForSelector('input[name="text"]', { timeout: 10000 });
        await page.fill('input[name="text"]', username);
        await page.click('text="次へ"');
        await page.waitForSelector('input[name="password"]', { timeout: 10000 });
        await page.fill('input[name="password"]', password);
        await page.click('div[data-testid="LoginForm_Login_Button"]');
        await page.waitForURL('https://x.com/home', { timeout: 30000 });
        log.info(`[${platform}:${username}] Successfully logged in to X.`);
        break;
      case 'tiktok':
        // TikTok login is complex due to captchas and phone verification.
        // For simplicity, we'll assume direct login via username/password.
        // In a real app, this would require more sophisticated handling (e.g., QR code login, manual intervention).
        await page.goto('https://www.tiktok.com/login', { waitUntil: 'networkidle', timeout: 30000 });
        await page.click('text="メール/ユーザー名/電話番号でログイン"');
        await page.waitForSelector('input[name="username"]', { timeout: 10000 });
        await page.fill('input[name="username"]', username);
        await page.fill('input[name="password"]', password);
        await page.click('button[type="submit"]');
        await page.waitForURL('https://www.tiktok.com/foryou', { timeout: 30000 });
        log.info(`[${platform}:${username}] Successfully logged in to TikTok.`);
        break;
      case 'instagram':
        await page.goto('https://www.instagram.com/accounts/login/', { waitUntil: 'networkidle', timeout: 30000 });
        await page.waitForSelector('input[name="username"]', { timeout: 10000 });
        await page.fill('input[name="username"]', username);
        await page.fill('input[name="password"]', password);
        await page.click('button[type="submit"]');
        await page.waitForURL('https://www.instagram.com/', { timeout: 30000 });
        log.info(`[${platform}:${username}] Successfully logged in to Instagram.`);
        break;
      case 'youtube':
        // YouTube login typically involves Google accounts, which is more complex.
        // This example assumes a direct YouTube login if available, or focuses on public content.
        // For full Google account login, OAuth or more advanced Playwright flows would be needed.
        await page.goto('https://accounts.google.com/ServiceLogin?service=youtube', { waitUntil: 'networkidle', timeout: 30000 });
        await page.waitForSelector('input[type="email"]', { timeout: 10000 });
        await page.fill('input[type="email"]', username);
        await page.click('div[id="identifierNext"]');
        await page.waitForSelector('input[type="password"]', { timeout: 10000 });
        await page.fill('input[type="password"]', password);
        await page.click('div[id="passwordNext"]');
        await page.waitForURL('https://www.youtube.com/', { timeout: 30000 });
        log.info(`[${platform}:${username}] Successfully logged in to YouTube.`);
        break;
      default:
        log.warn(`[${platform}:${username}] Login not implemented for this platform.`);
        break;
    }
  } catch (error: any) {
    log.error(`[${platform}:${username}] Login failed:`, error);
    throw new Error(`Login failed for ${platform}: ${error.message}`);
  } finally {
    await page.close();
  }
}

async function takeScreenshot(page: Page, platform: Platform, accountId: string): Promise<string> {
  const tempPath = app.getPath('temp');
  const fileName = `${platform}-${accountId}-${Date.now()}.png`;
  const screenshotPath = path.join(tempPath, fileName);

  // Wait for the main content to be visible
  // These selectors might need to be adjusted if the sites change.
  try {
    switch (platform) {
      case 'x':
        await page.waitForSelector('div[data-testid="primaryColumn"]', { timeout: 15000 });
        break;
      case 'instagram':
        await page.waitForSelector('main[role="main"]', { timeout: 15000 });
        break;
      case 'tiktok':
        await page.waitForSelector('div[data-e2e="user-post-list"]', { timeout: 15000 });
        break;
      case 'youtube':
        await page.waitForSelector('#contents', { timeout: 15000 });
        break;
    }
  } catch (e: any) {
    log.warn(`[${platform}:${accountId}] Could not find the primary content selector. The page might have changed or failed to load properly. Taking a screenshot anyway.`);
  }

  await page.screenshot({ path: screenshotPath, fullPage: true });
  return screenshotPath;
}

export async function scrapeAccount(
  platform: Platform,
  accountId: string,
  settings: AppSettings
): Promise<string | null> {
  log.info(`[${platform}:${accountId}] Starting scrape...`);
  const browser = await chromium.launch({ headless: true });
  let context: BrowserContext;
  const storageStatePath = path.join(app.getPath('userData'), `${platform}-storageState.json`);

  try {
    // Try to load saved session state
    let storageState;
    try {
      const fileContent = await fs.readFile(storageStatePath, 'utf8');
      storageState = JSON.parse(fileContent);
      log.info(`[${platform}:${accountId}] Loaded saved session state.`);
    } catch (e) {
      log.info(`[${platform}:${accountId}] No saved session state found or failed to load: ${e.message}`);
    }

    context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 1080 },
      storageState: storageState, // Load previous session state
    });

    const page = await context.newPage();
    const url = getPlatformUrl(platform, accountId);

    // New: Add scrape delay
    const scrapeDelay = settings.platforms[platform].scrapeDelayMs;
    if (scrapeDelay > 0) {
      log.info(`[${platform}:${accountId}] Waiting for ${scrapeDelay}ms before navigating.`);
      await page.waitForTimeout(scrapeDelay);
    }

    // Attempt to navigate and check if login is required
    try {
      await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
      log.info(`[${platform}:${accountId}] Page loaded: ${url}`);

      // New: Extract content based on platform
      switch (platform) {
        case 'x':
          // Extract RTs (reposts)
          const xPosts = await page.evaluate(() => {
            const posts: any[] = [];
            document.querySelectorAll('article[data-testid="tweet"]').forEach(post => {
              const isRetweet = post.querySelector('span:has-text("reposted")'); // Check for "reposted" text
              if (isRetweet) {
                const text = post.querySelector('div[data-testid="tweetText"]')?.textContent;
                const author = post.querySelector('a[role="link"] span')?.textContent;
                const link = post.querySelector('a[role="link"][href*="/status/"]')?.getAttribute('href');
                posts.push({ type: 'repost', author, text, link: `https://x.com${link}` });
              }
            });
            return posts;
          });
          if (xPosts.length > 0) {
            log.info(`[${platform}:${accountId}] Found X Reposts: ${JSON.stringify(xPosts, null, 2)}`);
          }
          break;
        case 'tiktok':
          // Extract short videos
          const tiktokVideos = await page.evaluate(() => {
            const videos: any[] = [];
            document.querySelectorAll('div[data-e2e="user-post-item"]').forEach(video => {
              const link = video.querySelector('a')?.getAttribute('href');
              const title = video.querySelector('div[data-e2e="video-desc"]')?.textContent;
              const playCount = video.querySelector('strong[data-e2e="video-views"]')?.textContent;
              videos.push({ type: 'short_video', title, link: `https://www.tiktok.com${link}`, playCount });
            });
            return videos;
          });
          if (tiktokVideos.length > 0) {
            log.info(`[${platform}:${accountId}] Found TikTok Videos: ${JSON.stringify(tiktokVideos, null, 2)}`);
          }
          break;
        case 'instagram':
          // Extract short videos (Reels)
          const instagramReels = await page.evaluate(() => {
            const reels: any[] = [];
            document.querySelectorAll('div[role="button"] img[alt*="Reel"]').forEach(reel => {
              const link = reel.closest('a')?.getAttribute('href');
              const imageUrl = reel.getAttribute('src');
              reels.push({ type: 'reel', link: `https://www.instagram.com${link}`, imageUrl });
            });
            return reels;
          });
          if (instagramReels.length > 0) {
            log.info(`[${platform}:${accountId}] Found Instagram Reels: ${JSON.stringify(instagramReels, null, 2)}`);
          }
          break;
        case 'youtube':
          // Extract YouTube Shorts
          const youtubeShorts = await page.evaluate(() => {
            const shorts: any[] = [];
            document.querySelectorAll('ytd-rich-grid-slim-media').forEach(short => {
              const link = short.querySelector('a#video-title')?.getAttribute('href');
              const title = short.querySelector('a#video-title')?.textContent;
              const viewCount = short.querySelector('span.ytd-thumbnail-overlay-time-status-renderer')?.textContent; // This might be duration, need to verify
              shorts.push({ type: 'short', title, link: `https://www.youtube.com${link}`, viewCount });
            });
            return shorts;
          });
          if (youtubeShorts.length > 0) {
            log.info(`[${platform}:${accountId}] Found YouTube Shorts: ${JSON.stringify(youtubeShorts, null, 2)}`);
          }
          break;
      }

    } catch (e: any) {
      log.warn(`[${platform}:${accountId}] Initial page load failed, attempting login. Reason: ${e.message}`);
      const service = getService(platform);
      const password = await keytar.getPassword(service, accountId); // Assuming accountId is the username
      if (password) {
        log.info(`[${platform}:${accountId}] Found credentials. Attempting login...`);
        await loginToPlatform(platform, accountId, password, context);
        // After successful login, try to navigate again
        await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
        log.info(`[${platform}:${accountId}] Page loaded after login: ${url}`);
      } else {
        log.warn(`[${platform}:${accountId}] No credentials found for ${accountId}. Skipping login.`);
        throw new Error(`Login required but no credentials found for ${accountId}.`);
      }
    }

    // Save current session state after successful navigation/login
    await fs.writeFile(storageStatePath, JSON.stringify(await context.storageState()));
    log.info(`[${platform}:${accountId}] Session state saved.`);

    const screenshotPath = await takeScreenshot(page, platform, accountId);
    log.info(`[${platform}:${accountId}] Screenshot taken: ${screenshotPath}`);
    return screenshotPath;

  } catch (error: any) {
    log.error(`[${platform}:${accountId}] Error during scraping:`, error);
    return null;
  } finally {
    await browser.close();
    log.info(`[${platform}:${accountId}] Browser closed.`);
  }
}