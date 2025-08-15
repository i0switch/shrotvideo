import ffmpeg from 'fluent-ffmpeg';
import { app } from 'electron';
import path from 'path';
import log from 'electron-log';
import type { AppSettings } from '../../src/core/settings.js';

// Function to safely escape text for ffmpeg drawtext filter
function escapeFFmpegText(text: string): string {
  if (typeof text !== 'string') return '';
  let escaped = '';
  for (const char of text) {
    if (char === '%' || char === '\\' || char === ':' || char === "'") { // Added space for clarity
      escaped += '\\' + char;
    } else {
      escaped += char;
    }
  }
  return escaped;
}

function getOverlayPosition(position: 'center' | 'top-center' | 'bottom-center' | 'custom', videoWidth: number, videoHeight: number, scale: number): string {
  const scaledWidth = videoWidth * scale;
  const scaledHeight = videoHeight * scale; // Assuming screenshot is scaled proportionally
  const x = (videoWidth - scaledWidth) / 2;
  const y = (videoHeight - scaledHeight) / 2;

  switch (position) {
    case 'center':
      return `(W-w)/2:(H-h)/2`;
    case 'top-center':
      return `(W-w)/2:0`;
    case 'bottom-center':
      return `(W-w)/2:H-h`;
    case 'custom':
      // For custom, we'll just use center for now, or could add more settings
      return `(W-w)/2:(H-h)/2`;
    default:
      return `(W-w)/2:(H-h)/2`;
  }
}

function getFontSize(videoHeight: number): number {
  // Adjust font size based on video height for better scaling
  if (videoHeight >= 1920) return 48;
  if (videoHeight >= 1080) return 36;
  return 24;
}

export function generateVideo(
  screenshotPath: string,
  settings: AppSettings,
  sourceVideoUrl?: string // New: Optional source video URL
): Promise<string> {
  return new Promise((resolve, reject) => {
    const { render, general } = settings;
    const outputFileName = `video-${Date.now()}.mp4`;
    const outputPath = path.join(general.outputPath, outputFileName);

    log.info(`Starting video generation. Output: ${outputPath}`);

    let inputVideoPath = render.backgroundVideoPath;
    let inputScreenshotIndex = 1; // Index for screenshot input in ffmpeg filter_complex

    if (sourceVideoUrl) {
      // If sourceVideoUrl is provided, use it as the main input video
      inputVideoPath = sourceVideoUrl;
      inputScreenshotIndex = -1; // No screenshot input if source video is used
      log.info(`Using source video URL: ${sourceVideoUrl}`);
    } else if (!render.backgroundVideoPath) {
      return reject(new Error('Background video path is not set and no source video URL provided.'));
    }

    const topText = escapeFFmpegText(render.captions.top);
    const bottomText = escapeFFmpegText(render.captions.bottom);

    let complexFilter: string[] = [];
    let ffmpegCommand = ffmpeg();

    if (sourceVideoUrl) {
      // If using source video, just scale and add text
      ffmpegCommand.input(inputVideoPath);
      complexFilter = [
        `[0:v]scale=${render.resolution.width}:${render.resolution.height},format=yuv420p[out]`,
        `[out]drawbox=x=0:y=0:w=iw:h=150:color=${render.teleTextBg}@0.8:t=fill`,
        `drawtext=text='${topText}':x=(w-text_w)/2:y=75-text_h/2:fontcolor=white:fontsize=${getFontSize(render.resolution.height)}`,
        `drawbox=x=0:y=h-150:w=iw:h=150:color=${render.teleTextBg}@0.8:t=fill`,
        `drawtext=text='${bottomText}':x=(w-text_w)/2:y=h-75-text_h/2:fontcolor=white:fontsize=${getFontSize(render.resolution.height)}`
      ];
    }

    else {
      // Original logic: overlay screenshot on background video
      ffmpegCommand.input(inputVideoPath).input(screenshotPath);
      complexFilter = [
        `[${inputScreenshotIndex}:v]scale=iw*${render.scale}:-1[fg]`,
        `[0:v]scale=${render.resolution.width}:${render.resolution.height},format=yuv420p[bg]`,
        `[bg][fg]overlay=${getOverlayPosition(render.overlayPosition, render.resolution.width, render.resolution.height, render.scale)}`,
        `drawbox=x=0:y=0:w=iw:h=150:color=${render.teleTextBg}@0.8:t=fill`,
        `drawtext=text='${topText}':x=(w-text_w)/2:y=75-text_h/2:fontcolor=white:fontsize=${getFontSize(render.resolution.height)}`,
        `drawbox=x=0:y=h-150:w=iw:h=150:color=${render.teleTextBg}@0.8:t=fill`,
        `drawtext=text='${bottomText}':x=(w-text_w)/2:y=h-75-text_h/2:fontcolor=white:fontsize=${getFontSize(render.resolution.height)}`
      ];
    }

    ffmpegCommand.complexFilter(complexFilter.join(','));

    ffmpegCommand.outputOptions([
      `-t ${render.durationSec}`,
      `-c:v libx264`,
      `-preset ${getFFmpegPreset(render.qualityPreset)}`,
      `-pix_fmt yuv420p`,
      `-c:a aac`,
    ]);

    if (render.bgmPath) {
      ffmpegCommand.input(render.bgmPath)
        .outputOptions([
          `-map 0:a?`,
          `${sourceVideoUrl ? '-map 1:a?' : '-map 2:a?'}`, // Adjust audio map based on sourceVideoUrl
          `-shortest`,
          `-filter:a:1 volume=0.6` // BGM volume control
        ]);
    }

    ffmpegCommand
      .on('end', () => {
        log.info(`Video generation finished successfully: ${outputPath}`);
        resolve(outputPath);
      })
      .on('error', (err) => {
        log.error(`Error during video generation: ${err.message}`);
        reject(err);
      })
      .save(outputPath);
  });
}