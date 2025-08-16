import ffmpeg from 'fluent-ffmpeg';
import { app } from 'electron';
import path from 'path';
import log from 'electron-log';
import type { AppSettings } from '../../src/core/settings.js';

// Utility to normalize path separators for cross-platform compatibility
function normalizePath(p: string): string {
  return p.replace(/\\/g, '/');
}

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

function getFontSize(videoHeight: number, size: 'top' | 'bottom'): number {
    // These font sizes are based on the GEMINI.md example for a 1920 height video.
    // We can scale them proportionally for other resolutions.
    const baseHeight = 1920;
    const topBaseSize = 48;
    const bottomBaseSize = 42;
    const scaleFactor = videoHeight / baseHeight;

    return size === 'top' ? Math.round(topBaseSize * scaleFactor) : Math.round(bottomBaseSize * scaleFactor);
}

function getFFmpegPreset(quality: 'fast' | 'standard' | 'high' | string): string {
    switch (quality) {
        case 'fast':
            return 'ultrafast';
        case 'standard':
            return 'veryfast';
        case 'high':
            return 'medium';
        default:
            return 'veryfast';
    }
}

export function generateVideo(
  screenshotPath: string,
  settings: AppSettings,
  sourceVideoUrl?: string // Optional source video URL for Function B
): Promise<string> {
  return new Promise((resolve, reject) => {
    const { render, general } = settings;
    const outputFileName = `video-${Date.now()}.mp4`;
    // Note: outputPath is created with path.join, which is OS-specific. We normalize it for ffmpeg.
    const outputPath = normalizePath(path.join(general.outputPath, outputFileName));

    log.info(`Starting video generation. Output: ${outputPath}`);

    const topText = escapeFFmpegText(render.captions.top);
    const bottomText = escapeFFmpegText(render.captions.bottom);

    const videoHeight = render.resolution.height;
    const topCaptionHeight = render.topCaptionHeight;
    const bottomCaptionHeight = render.bottomCaptionHeight;
    const topFontSize = getFontSize(videoHeight, 'top');
    const bottomFontSize = getFontSize(videoHeight, 'bottom');
    const topTextY = Math.round((topCaptionHeight - topFontSize) / 2); // Vertically center text in the box
    const bottomTextY = videoHeight - bottomCaptionHeight + Math.round((bottomCaptionHeight - bottomFontSize) / 2);

    const ffmpegCommand = ffmpeg();
    let complexFilter: string[] = [];
    let audioMapIndex = 1; // Start with 1, assuming background video audio is 0

    // Base video input (background or source video)
    let inputVideoPath = sourceVideoUrl || render.backgroundVideoPath;
    if (!inputVideoPath) {
        return reject(new Error('A background or source video must be provided.'));
    }
    // Normalize path if it's not a URL
    ffmpegCommand.input(inputVideoPath.startsWith('http') ? inputVideoPath : normalizePath(inputVideoPath));

    // Screenshot input (only for Function A)
    if (!sourceVideoUrl && screenshotPath) {
        ffmpegCommand.input(normalizePath(screenshotPath));
        const screenshotIndex = 1; // screenshot is the second input
        complexFilter.push(
            `[${screenshotIndex}:v]scale=iw*${render.scale}:-1[fg]`,
            `[0:v]scale=${render.resolution.width}:${render.resolution.height},format=yuv420p[bg]`,
            `[bg][fg]overlay=${getOverlayPosition(render.overlayPosition, render.resolution.width, render.resolution.height, render.scale)}[base_with_overlay]`
        );
    } else {
        // For Function B, just scale the source video
        complexFilter.push(`[0:v]scale=${render.resolution.width}:${render.resolution.height},format=yuv420p[base_with_overlay]`);
    }

    const currentVideo = complexFilter.length > 0 ? '[base_with_overlay]' : '[0:v]';

    // Add caption boxes and text
    complexFilter.push(
        `${currentVideo}drawbox=x=0:y=0:w=iw:h=${topCaptionHeight}:color=${render.teleTextBg}@${render.captionBgOpacity}:t=fill[v_with_top_box]`,
        `[v_with_top_box]drawtext=text='${topText}':x=(w-text_w)/2:y=${topTextY}:fontcolor=white:fontsize=${topFontSize}[v_with_top_text]`,
        `[v_with_top_text]drawbox=x=0:y=h-${bottomCaptionHeight}:w=iw:h=${bottomCaptionHeight}:color=${render.teleTextBg}@${render.captionBgOpacity}:t=fill[v_with_bottom_box]`,
        `[v_with_bottom_box]drawtext=text='${bottomText}':x=(w-text_w)/2:y=${bottomTextY}:fontcolor=white:fontsize=${bottomFontSize}`
    );

    ffmpegCommand.complexFilter(complexFilter.join(', '));

    // Add BGM if specified
    if (render.bgmPath) {
        ffmpegCommand.input(normalizePath(render.bgmPath));
        audioMapIndex++; // BGM is now the next audio stream
    }

    ffmpegCommand.outputOptions([
        `-t ${render.durationSec}`,
        '-c:v libx264',
        `-preset ${getFFmpegPreset(render.qualityPreset)}`,
        '-pix_fmt yuv420p',
        '-c:a aac',
        '-shortest' // Ensure output duration doesn't exceed the shortest input (e.g., short BGM)
    ]);

    // Map audio streams
    // Map 0:a? -> background/source video's audio (if it exists)
    // Map 1:a? -> BGM's audio (if it exists)
    ffmpegCommand.outputOptions('-map 0:a?');
    if (render.bgmPath) {
        ffmpegCommand.outputOptions(`-map ${audioMapIndex - 1}:a?`);
        // You might want to control volume, e.g., lower BGM volume
        // This is more complex with multiple streams, so keeping it simple for now.
    }

    ffmpegCommand
      .on('start', (commandLine) => {
          log.info('Spawned Ffmpeg with command: ' + commandLine);
      })
      .on('end', () => {
        log.info(`Video generation finished successfully: ${outputPath}`);
        resolve(outputPath);
      })
      .on('error', (err, stdout, stderr) => {
        log.error(`Error during video generation: ${err.message}`);
        log.error('ffmpeg stdout:\n' + stdout);
        log.error('ffmpeg stderr:\n' + stderr);
        reject(err);
      })
      .save(outputPath);
  });
}