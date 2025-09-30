import { Page } from 'playwright';
import { createLogger } from '@core/logging/logger';
import { ClassificationResult, MediaBoundingBox } from '@core/types';

const logger = createLogger('mediaProbe');

export async function detectMedia(page: Page): Promise<ClassificationResult> {
  const classification = await page.evaluate(() => {
    const videoElements = Array.from(document.querySelectorAll('video'));
    const imageElements = Array.from(document.querySelectorAll('img[data-testid="tweetPhoto"]'));

    const hasVideo = videoElements.length > 0;
    const hasMultipleVideos = videoElements.length > 1;
    const hasImage = imageElements.length > 0;

    return {
      kind: hasVideo ? (hasMultipleVideos ? 'multi_video' : 'single_video') : hasImage ? 'image' : 'text',
      hasVideo,
      hasMultipleVideos,
      hasImage
    } as ClassificationResult;
  });

  logger.info('Detected media classification', classification);
  return classification;
}

export async function locateVideoBoundingBox(page: Page): Promise<MediaBoundingBox | undefined> {
  const box = await page.evaluate(() => {
    const video = document.querySelector('video');
    if (!video) {
      return undefined;
    }
    const rect = video.getBoundingClientRect();
    return {
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height
    } satisfies MediaBoundingBox;
  });

  logger.info('Video bounding box', box);
  return box;
}
