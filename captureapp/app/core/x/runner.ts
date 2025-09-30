import fs from 'fs';
import path from 'path';
import dayjs from 'dayjs';
import pLimit from 'p-limit';
import { BrowserContext } from 'playwright';
import { launchBrowser } from '@core/x/browser';
import { ensureLoggedIn } from '@core/x/login';
import { fetchLatestPosts } from '@core/x/fetchPosts';
import { openPost } from '@core/x/openPost';
import { detectMedia, locateVideoBoundingBox } from '@core/x/mediaProbe';
import { captureRegion } from '@core/x/screenshot';
import { collectVideoUrl, downloadVideo } from '@core/x/download';
import { overlayVideo } from '@core/media/compose';
import { createLogger } from '@core/logging/logger';
import { ensureDir, resolveOutputs } from '@core/utils/paths';
import { writeJson, writePostMeta } from '@core/utils/meta';
import { PostProcessResult, RunnerConfig, RunnerSummary } from '@core/types';
import { recordElementFallback } from '@core/x/elementCapture';
import { getFfmpegCommand } from '@core/media/ffmpeg';

const logger = createLogger('runner');
const DEFAULT_PARALLEL = 2;
const MAX_ATTEMPTS = 3;

async function processSinglePost(options: {
  selector: string;
  outputsDir: string;
  post: PostProcessResult['target'];
  context: BrowserContext;
}): Promise<PostProcessResult> {
  const { selector, outputsDir, post, context } = options;
  const { postDir: targetDir } = resolveOutputs(outputsDir, post.tweetId);
  const baseResult: PostProcessResult = {
    target: post,
    outputDir: targetDir,
    screenshotPath: path.join(targetDir, 'screenshot.png'),
    videoPath: undefined,
    compositedPath: undefined,
    metaPath: path.join(targetDir, 'meta.json'),
    classification: {
      kind: 'text',
      hasVideo: false,
      hasMultipleVideos: false,
      hasImage: false
    },
    boundingBox: undefined,
    attempts: 0,
    status: 'failed',
    errors: [],
    downloadSource: undefined
  };

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    baseResult.attempts = attempt;
    const page = await context.newPage();
    try {
      logger.info('Processing post', { tweetId: post.tweetId, attempt });
      await openPost(page, post.url);
      await page.waitForTimeout(1000);
      await page.evaluate(() => {
        const video = document.querySelector<HTMLVideoElement>('video');
        if (video) {
          video.muted = true;
          void video.play().catch(() => undefined);
        }
      });

      const classification = await detectMedia(page);
      baseResult.classification = classification;

      const screenshot = await captureRegion(page, {
        selector,
        outDir: targetDir,
        filename: 'screenshot.png'
      });
      baseResult.screenshotPath = screenshot.path;

      if (classification.kind === 'single_video') {
        const videoCandidatePromise = collectVideoUrl(page, post.tweetId);
        const pageVideoBox = await locateVideoBoundingBox(page);
        if (pageVideoBox && screenshot.clip) {
          // ページ座標系からスクリーンショットのクリップ原点へ変換
          const normalized = {
            x: Math.max(0, Math.round(pageVideoBox.x - screenshot.clip.x)),
            y: Math.max(0, Math.round(pageVideoBox.y - screenshot.clip.y)),
            width: Math.round(pageVideoBox.width),
            height: Math.round(pageVideoBox.height)
          } as const;
          baseResult.boundingBox = normalized;
        } else {
          baseResult.boundingBox = pageVideoBox;
        }

        const videoCandidate = await videoCandidatePromise;
        if (!videoCandidate) {
          throw new Error('動画 URL を検出できませんでした');
        }

        let download;
        try {
          download = await downloadVideo(
            videoCandidate.url,
            targetDir,
            'video.mp4',
            page,
            videoCandidate.headers
          );
          baseResult.videoPath = download.filePath;
          baseResult.downloadSource = download.sourceUrl;
          logger.info('Video downloaded', { tweetId: post.tweetId, source: download.sourceUrl });
        } catch (e) {
          logger.warn('Primary download failed, trying element recording fallback', {
            tweetId: post.tweetId,
            message: e instanceof Error ? e.message : String(e)
          });
          const webm = await recordElementFallback({ page, outDir: targetDir, durationMs: 6000 });
          if (!webm) throw e;
          // Transcode webm to mp4 for uniform pipeline
          const mp4 = path.join(targetDir, 'video.mp4');
          const ffmpeg = getFfmpegCommand();
          await new Promise<void>((resolve, reject) => {
            ffmpeg(webm)
              .outputOptions(['-c:v libx264', '-c:a aac', '-pix_fmt yuv420p', '-movflags +faststart'])
              .on('end', () => resolve())
              .on('error', (err: Error) => reject(err))
              .save(mp4);
          });
          baseResult.videoPath = mp4;
          baseResult.downloadSource = 'fallback:element-recording';
          logger.info('Element recording fallback succeeded', { tweetId: post.tweetId, file: mp4 });
        }

        if (baseResult.boundingBox) {
          try {
            const composited = await overlayVideo({
              screenshotPath: baseResult.screenshotPath,
              videoPath: baseResult.videoPath!,
              outputDir: targetDir,
              fileName: 'composited.mp4',
              boundingBox: baseResult.boundingBox!
            });
            baseResult.compositedPath = composited;
          } catch (e) {
            logger.warn('Primary overlay failed, retry after short wait', {
              tweetId: post.tweetId,
              message: e instanceof Error ? e.message : String(e)
            });
            await page.waitForTimeout(300);
            const composited = await overlayVideo({
              screenshotPath: baseResult.screenshotPath,
              videoPath: baseResult.videoPath!,
              outputDir: targetDir,
              fileName: 'composited.mp4',
              boundingBox: baseResult.boundingBox!
            });
            baseResult.compositedPath = composited;
          }
        } else {
          baseResult.status = 'partial';
          baseResult.errors.push('動画領域を特定できなかったため合成をスキップ');
        }
      }

      if (baseResult.status !== 'partial') {
        baseResult.status = 'success';
      }
      logger.info('Post processed successfully', { tweetId: post.tweetId, status: baseResult.status });
      break;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('Post processing attempt failed', { tweetId: post.tweetId, attempt, message });
      baseResult.errors.push(message);
      baseResult.status = 'failed';
      if (attempt === MAX_ATTEMPTS) {
        // exhausted retries
      }
    } finally {
      await page.close().catch(() => undefined);
    }

    if (baseResult.status !== 'failed') {
      break;
    }

    if (attempt < MAX_ATTEMPTS) {
      await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
    }
  }

  writePostMeta(baseResult, selector, baseResult.downloadSource);
  return baseResult;
}

export async function runCapture(config: RunnerConfig): Promise<RunnerSummary> {
  const runId = dayjs().format('YYYYMMDD-HHmmss-SSS');
  const { outDir, selector, storageStatePath } = config;

  ensureDir(outDir);
  const outputsDir = path.resolve(outDir, `final_run_${runId}`);
  ensureDir(outputsDir);

  const browser = await launchBrowser({ headless: config.headless, channel: config.browserChannel });

  const context = await browser.newContext(
    fs.existsSync(storageStatePath) ? { storageState: storageStatePath } : undefined
  );

  await ensureLoggedIn(context, { storageStatePath, headless: config.headless });

  const page = await context.newPage();
  const posts = await fetchLatestPosts(page, config.handle, config.count);
  await page.close();
  logger.info('Fetched posts', { requested: config.count, actual: posts.length });

  const limit = pLimit(Math.max(1, config.parallel ?? DEFAULT_PARALLEL));
  const tasks = posts.map((post) =>
    limit(() =>
      processSinglePost({
        selector,
        outputsDir,
        post,
        context
      })
    )
  );

  const results = await Promise.all(tasks);

  await context.storageState({ path: storageStatePath });
  await context.close();
  await browser.close();

  const summary: RunnerSummary = {
    runId,
    createdAt: new Date().toISOString(),
    handle: config.handle,
    count: config.count,
    total: results.length,
    success: results.filter((r) => r.status === 'success').length,
    partial: results.filter((r) => r.status === 'partial').length,
    failed: results.filter((r) => r.status === 'failed').length,
    outputsDir,
    results
  };

  writeJson(path.join(outputsDir, 'run_meta.json'), summary);
  logger.info('Run summary stored', {
    outputsDir,
    success: summary.success,
    partial: summary.partial,
    failed: summary.failed
  });

  return summary;
}
