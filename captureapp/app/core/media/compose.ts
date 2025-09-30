import path from 'path';
import { createLogger } from '@core/logging/logger';
import { ensureDir } from '@core/utils/paths';
import { MediaBoundingBox } from '@core/types';
import { getFfmpegCommand } from './ffmpeg';

const logger = createLogger('compose');

export interface ComposeOptions {
  screenshotPath: string;
  videoPath: string;
  outputDir: string;
  fileName: string;
  boundingBox: MediaBoundingBox;
}

export async function overlayVideo(options: ComposeOptions): Promise<string> {
  const { screenshotPath, videoPath, outputDir, fileName, boundingBox } = options;
  ensureDir(outputDir);
  const outputPath = path.join(outputDir, fileName);

  logger.info('Compositing video overlay', { outputPath, boundingBox });

  const ffmpeg = getFfmpegCommand();
  // Try primary filter graph; on failure, retry with a more permissive pipeline
  const runOverlay = (opts: { permissive?: boolean }) =>
    new Promise<void>((resolve, reject) => {
      const x = Math.max(0, Math.round(boundingBox.x));
      const y = Math.max(0, Math.round(boundingBox.y));
      const w = Math.max(1, Math.round(boundingBox.width));
      const h = Math.max(1, Math.round(boundingBox.height));

      const cmd = ffmpeg();
      // Loop the static screenshot as a 30fps background video
      cmd.input(screenshotPath).inputOptions(['-loop 1', '-framerate 30']);
      cmd.input(videoPath);

      if (!opts.permissive) {
        cmd
          .complexFilter([
            // Ensure background has even dimensions and stable pixel format
            `[0:v]scale=trunc(iw/2)*2:trunc(ih/2)*2,format=rgba[bg]`,
            // Scale video to fit the bounding box while keeping AR, even dimensions, square pixels
            `[1:v]scale=${w}:${h}:force_original_aspect_ratio=decrease:force_divisible_by=2,setsar=1,format=yuv420p[vid]`,
            // Overlay video onto background at given coordinates
            `[bg][vid]overlay=${x}:${y}:eval=init:shortest=1[outv]`
          ])
          .outputOptions([
            '-map [outv]',
            '-map 1:a?', // take audio from the video if present
            '-c:v libx264',
            '-c:a aac',
            '-pix_fmt yuv420p',
            '-vsync 2',
            '-shortest',
            '-movflags +faststart',
            '-preset veryfast'
          ]);
      } else {
        // Permissive graph using scale2ref to adapt video to background
        cmd
          .complexFilter([
            `[0:v]scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p[bg]`,
            `[1:v][bg]scale2ref=w=${w}:h=${h}[vid][bgr]`,
            `[bgr][vid]overlay=${x}:${y}:eval=init:shortest=1[outv]`
          ])
          .outputOptions([
            '-map [outv]',
            '-map 1:a?',
            '-c:v libx264',
            '-c:a aac',
            '-pix_fmt yuv420p',
            '-vsync 2',
            '-shortest',
            '-movflags +faststart',
            '-preset veryfast'
          ]);
      }

      cmd
        .save(outputPath)
        .on('end', () => resolve())
        .on('error', (err: Error) => reject(err));
    });

  try {
    await runOverlay({ permissive: false });
  } catch (e1) {
    logger.warn('Primary overlay pipeline failed, retrying with permissive graph', {
      message: e1 instanceof Error ? e1.message : String(e1)
    });
    await runOverlay({ permissive: true });
  }

  return outputPath;
}
