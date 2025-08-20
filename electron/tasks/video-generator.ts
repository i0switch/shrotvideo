import ffmpeg from 'fluent-ffmpeg';
import ffmpegStatic from 'ffmpeg-static';
import { app } from 'electron';
import path from 'path';
import log from 'electron-log';
import type { AppSettings } from '../../src/core/settings.js';
import fs from 'node:fs';

// Utility to normalize path separators for cross-platform compatibility
function normalizePath(p: string): string {
  return p.replace(/\\/g, '/');
}

// Function to safely escape text for ffmpeg drawtext filter
function escapeFFmpegText(text: string): string {
  if (typeof text !== 'string') return '';
  // 1) 改行は drawtext では \n で表現する必要がある
  // 2) 区切り文字や特殊文字はバックスラッシュでエスケープ
  const value = text.replace(/\r?\n/g, '\\n');
  let escaped = '';
  for (const char of value) {
    if (char === '%' || char === '\\' || char === ':' || char === "'") {
      escaped += '\\' + char;
    } else {
      escaped += char;
    }
  }
  return escaped;
}

// 数値の安全評価・フォールバック
function toNumberOr<T extends number>(v: unknown, fallback: T): T {
  const n = Number(v);
  return Number.isFinite(n) ? (n as T) : fallback;
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

// フィルタ引数内のパス用エスケープ（drawtext の fontfile 等）
function escapeFilterPath(p: string): string {
  const n = normalizePath(p);
  // ':' と 単一引用符をエスケープ
  return n.replace(/:/g, '\\:').replace(/'/g, "\\'");
}

function getDefaultFontPath(): string | null {
  try {
    if (process.platform === 'win32') {
      const candidates = [
  'C:/Windows/Fonts/arial.ttf',
  'C:/Windows/Fonts/ARIAL.TTF',
  'C:/Windows/Fonts/meiryo.ttc',
  'C:/Windows/Fonts/meiryob.ttc',
  'C:/Windows/Fonts/msgothic.ttc',
  'C:/Windows/Fonts/MSGOTHIC.TTC',
  'C:/Windows/Fonts/YuGothR.ttc',
  'C:/Windows/Fonts/YuGothM.ttc',
  'C:/Windows/Fonts/seguiemj.ttf',
  'C:/Windows/Fonts/segoeui.ttf',
      ];
      for (const c of candidates) if (fs.existsSync(c)) return c;
    } else if (process.platform === 'darwin') {
      const candidates = [
        '/Library/Fonts/Arial.ttf',
        '/System/Library/Fonts/Supplemental/Arial.ttf',
        '/Library/Fonts/ヒラギノ角ゴシック W3.ttc',
      ];
      for (const c of candidates) if (fs.existsSync(c)) return c;
    } else {
      const candidates = [
        '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
        '/usr/share/fonts/truetype/freefont/FreeSans.ttf',
      ];
      for (const c of candidates) if (fs.existsSync(c)) return c;
    }
  } catch { /* ignore */ }
  return null;
}

// Convert CSS hex (#RRGGBB) or known names to ffmpeg color (0xRRGGBB or name)
function toFfmpegColor(input: string | undefined, fallback: string): string {
  if (!input) return fallback;
  const t = input.trim();
  const m = /^#?([0-9a-fA-F]{6})$/.exec(t);
  if (m) return `0x${m[1]}`;
  const known = ['white','black','red','green','blue','yellow','cyan','magenta','gray','grey','orange','purple'];
  if (known.includes(t.toLowerCase())) return t.toLowerCase();
  return fallback;
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
  sourceVideoUrl?: string
): Promise<string> {
  return new Promise((resolve, reject) => {
    // Ensure ffmpeg binary is configured (fallback to PATH if not available)
    try {
      const bin = (ffmpegStatic as unknown as string) || '';
      if (bin) {
        (ffmpeg as unknown as { setFfmpegPath: (p: string) => void }).setFfmpegPath(bin);
      }
    } catch { /* ignore */ }
    const { render: rawRender, general } = settings;
    const videoWidth = toNumberOr(rawRender?.resolution?.width, 1080);
    const videoHeight = toNumberOr(rawRender?.resolution?.height, 1920);
    const scale = clamp(toNumberOr(rawRender?.scale, 0.8), 0.05, 5);
    const teleTextBg = rawRender?.teleTextBg || '#000000';
    const captionTextColor = rawRender?.captionTextColor || '#ffffff';
    const captionBgOpacity = clamp(toNumberOr(rawRender?.captionBgOpacity, 1.0), 0, 1);
    const captionPadding = Math.max(8, Math.round(videoHeight * (16 / 1920)));
    const durationSec = Math.max(1, toNumberOr(rawRender?.durationSec, 15));
    const overlayPosition = (rawRender?.overlayPosition as 'center' | 'top-center' | 'bottom-center' | 'custom') || 'center';
    const fontFileFromSettings = rawRender?.fontFilePath && rawRender.fontFilePath.trim() ? rawRender.fontFilePath.trim() : '';
    const qualityPreset = (rawRender?.qualityPreset as 'low' | 'standard' | 'high' | string) || 'standard';
    const captionsTop = escapeFFmpegText(rawRender?.captions?.top ?? '');
    const captionsBottom = escapeFFmpegText(rawRender?.captions?.bottom ?? '');

    const outputFileName = `video-${Date.now()}.mp4`;
    const outputPath = normalizePath(path.join(general.outputPath, outputFileName));

    log.info(`Starting video generation. Output: ${outputPath}`);

    const topText = captionsTop;
    const bottomText = captionsBottom;
    const topFontSize = getFontSize(videoHeight, 'top');
    const bottomFontSize = getFontSize(videoHeight, 'bottom');
    const topOffset = toNumberOr(rawRender?.topCaptionOffset, 0);
    const bottomOffset = toNumberOr(rawRender?.bottomCaptionOffset, 0);
    const yTopExpr = `${captionPadding}+${topOffset}`;
    const yBottomExpr = `h-text_h-${captionPadding}+${bottomOffset}`;

    const ffmpegCommand = ffmpeg();
    const complexFilter: string[] = [];

    // Base input
    const inputVideoPath = sourceVideoUrl || rawRender?.backgroundVideoPath;
    if (!inputVideoPath) return reject(new Error('A background or source video must be provided.'));
    ffmpegCommand.input(inputVideoPath.startsWith('http') ? inputVideoPath : normalizePath(inputVideoPath));

    // Optional screenshot overlay
    let nextInputIndex = 1; // base video is 0
    if (!sourceVideoUrl && screenshotPath) {
      ffmpegCommand.input(normalizePath(screenshotPath));
      const screenshotIndex = 1;
      const overlayYExpr = overlayPosition === 'top-center' ? `0` : overlayPosition === 'bottom-center' ? `H-h` : `(H-h)/2`;
      complexFilter.push(
        `[${screenshotIndex}:v]scale=w='min(iw*${scale},${videoWidth})':h='min(ih*${scale},${videoHeight})':force_original_aspect_ratio=decrease[fg]`,
        `[0:v]scale=${videoWidth}:${videoHeight},format=yuv420p[bg]`,
        `[bg][fg]overlay=(W-w)/2:${overlayYExpr}[base_with_overlay]`
      );
      nextInputIndex = 2;
    } else {
      complexFilter.push(`[0:v]scale=${videoWidth}:${videoHeight},format=yuv420p[base_with_overlay]`);
    }

    const currentVideo = complexFilter.length > 0 ? '[base_with_overlay]' : '[0:v]';

    // Text with box around text only
    const fontPath = fontFileFromSettings || getDefaultFontPath();
    if (fontPath) {
      log.info('[video-generator] using fontfile:', fontPath);
      const fontOpt = `:fontfile='${escapeFilterPath(fontPath)}'${/\.ttc$/i.test(fontPath) ? ':fontindex=0' : ''}`;
      const boxColor = `${toFfmpegColor(teleTextBg, 'black')}@${captionBgOpacity}`;
      const textColor = toFfmpegColor(captionTextColor, 'white');
      let curr = currentVideo;
      if (topText && topText.trim().length > 0) {
        complexFilter.push(`${curr}drawtext=text='${topText}':x=(w-text_w)/2:y=${yTopExpr}:fontcolor=${textColor}:fontsize=${topFontSize}:box=1:boxcolor=${boxColor}:boxborderw=${captionPadding}${fontOpt}[v_t1]`);
        curr = '[v_t1]';
      }
      if (bottomText && bottomText.trim().length > 0) {
        complexFilter.push(`${curr}drawtext=text='${bottomText}':x=(w-text_w)/2:y=${yBottomExpr}:fontcolor=${textColor}:fontsize=${bottomFontSize}:box=1:boxcolor=${boxColor}:boxborderw=${captionPadding}${fontOpt}`);
      }
    } else {
      log.warn('[video-generator] no fontfile found. Skipping drawtext to avoid fontconfig crash.');
    }

  // Use semicolons to separate independent filter chains
  const filterGraph = complexFilter.join('; ');
    log.info('[video-generator] filterGraph:', filterGraph);
    ffmpegCommand.complexFilter(filterGraph);

    // Optional BGM input and audio mapping
    let bgmInputIndex: number | undefined;
    if (rawRender?.bgmPath) {
      ffmpegCommand.input(normalizePath(rawRender.bgmPath));
      bgmInputIndex = nextInputIndex; // after base and optional screenshot
      nextInputIndex += 1;
    }

    ffmpegCommand
      .duration(durationSec)
      .videoCodec('libx264')
      .outputOptions([
        '-preset', getFFmpegPreset(qualityPreset),
        '-pix_fmt', 'yuv420p',
        '-c:a', 'aac',
        '-shortest'
      ]);

    // Map audio: background/source video and optional BGM
    ffmpegCommand.outputOptions(['-map', '0:a?']);
    if (bgmInputIndex !== undefined) {
      ffmpegCommand.outputOptions(['-map', `${bgmInputIndex}:a?`]);
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