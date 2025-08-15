import log from 'electron-log';
import type { AppSettings, Platform } from '../core/settings';
import ytdlp from 'ytdlp-nodejs';

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

export async function scrapeAccount(
  platform: Platform,
  accountId: string,
  settings: AppSettings,
): Promise<string | null> {
  log.info(`[${platform}:${accountId}] Starting scrape...`);

  if (platform === 'tiktok' || platform === 'youtube' || platform === 'instagram') {
    const accountUrl = getPlatformUrl(platform, accountId);
    try {
      log.info(`[${platform}:${accountId}] Using yt-dlp to get latest video URL from ${accountUrl}`);
      const video = await ytdlp(accountUrl, {
        dumpSingleJson: true,
        playlistItems: '1',
      });

      if (video && video.url) {
        log.info(`[${platform}:${accountId}] Found video URL: ${video.url}`);
        return video.url;
      } else {
        log.warn(`[${platform}:${accountId}] yt-dlp did not return a video URL directly.`);
        const videoFromWebpage = (video as any).webpage_url;
        if (videoFromWebpage) {
            log.info(`[${platform}:${accountId}] Found webpage URL, attempting to re-run yt-dlp on it: ${videoFromWebpage}`);
            const directVideo = await ytdlp(videoFromWebpage, { getUrl: true });
            if (directVideo) {
                log.info(`[${platform}:${accountId}] Found direct video URL: ${directVideo}`);
                return directVideo.toString();
            }
        }
        return null;
      }
    } catch (error: any) {
      log.error(`[${platform}:${accountId}] yt-dlp failed:`, error.message);
      return null;
    }
  }

  if (platform === 'x') {
    log.warn(`[${platform}:${accountId}] X scraping is temporarily disabled.`);
    return null;
  }

  return null;
}
