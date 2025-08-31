import ffmpeg from 'fluent-ffmpeg';
import ffmpegStatic from 'ffmpeg-static';
import { app } from 'electron';
import path from 'path';
import log from 'electron-log';
import type { AppSettings } from '../../src/core/settings';
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

// app.asar -> app.asar.unpacked に安全に解決（パッケージ版で実行ファイルを使うため）
function resolvePackedBinary(p: string | undefined | null): string | undefined {
  if (!p) return undefined;
  try {
    let fixed = p;
    if (fixed.includes('app.asar\\')) fixed = fixed.replace('app.asar\\', 'app.asar.unpacked\\');
    if (fixed.includes('app.asar/')) fixed = fixed.replace('app.asar/', 'app.asar.unpacked/');
    if (fixed !== p && fs.existsSync(fixed)) return fixed;
    if (fs.existsSync(p)) return p;
  } catch { /* ignore */ }
  return p || undefined;
}

// Convert CSS hex (#RRGGBB) or known names to ffmpeg color (0xRRGGBB or name)
function toFfmpegColor(input: string | undefined, fallback: string): string {
  if (!input) return fallback;
  const t = input.trim();
  const m = /^#?([0-9a-fA-F]{6})$/.exec(t);
  // Prefer #RRGGBB so alpha via @opacity works reliably with filters like drawbox/drawtext
  if (m) return `#${m[1]}`;
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

// Probe whether file has a video stream
function hasVideoStream(filePath: string): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      ffmpeg.ffprobe(filePath, (err, data) => {
        if (err || !data) return resolve(false);
        const v = (data.streams || []).some((s) => String((s as { codec_type?: string }).codec_type).toLowerCase() === 'video');
        resolve(v);
      });
    } catch (e) {
        log.warn(`[downloader] hasVideoStream check failed for ${filePath}`, e);
        resolve(false);
    }
  });
}

export function generateVideo(
  screenshotPath: string,
  settings: AppSettings,
  sourceVideoUrl?: string,
  opts?: { forceDuration?: boolean }
): Promise<string> {
  return new Promise((resolve, reject) => {
    const run = async () => {
    // Ensure ffmpeg binary is configured (fallback to PATH if not available)
    try {
      const raw = (ffmpegStatic as unknown as string) || '';
      const bin = resolvePackedBinary(raw) || raw;
      if (bin) {
        (ffmpeg as unknown as { setFfmpegPath: (p: string) => void }).setFfmpegPath(bin);
      }
    } catch { /* ignore */ }
    const { render: rawRender, general } = settings;
    const videoWidth = toNumberOr(rawRender?.resolution?.width, 1080);
    const videoHeight = toNumberOr(rawRender?.resolution?.height, 1920);
  // スケールは 1.0 を上限（1=画面の安全領域にピッタリ収まる）
  const scale = clamp(toNumberOr(rawRender?.scale, 0.8), 0.05, 1.0);
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
  // テロップ用の上/下ボックス高さ（プレビューと同じ既定値に近づける）
  const defaultTopH = Math.round(videoHeight * (120 / 1920));
  const defaultBottomH = Math.round(videoHeight * (160 / 1920));
  const topCaptionHeight = Math.max(0, toNumberOr(rawRender?.topCaptionHeight, defaultTopH));
  const bottomCaptionHeight = Math.max(0, toNumberOr(rawRender?.bottomCaptionHeight, defaultBottomH));
  const safeHeight = Math.max(1, videoHeight - topCaptionHeight - bottomCaptionHeight);
  // キャプションは常に文字の周りだけ背景枠（drawtext:box）を付与する運用に変更
  // フル幅バーは描画しない（要求②: 上側の背景が大きすぎるを解消、要求①: 下側にも必ず背景を付与）
  const yTopExprDefault = `${captionPadding}+${topOffset}`;
  const yBottomExprDefault = `h-text_h-${captionPadding}+${bottomOffset}`;

  const ffmpegCommand = ffmpeg();
  const complexFilter: string[] = [];
  // Track the current labeled video pad to map it explicitly later
  let finalVideoLabel: string | null = null;

    // Base input(s)
    const bgPath = rawRender?.backgroundVideoPath && rawRender.backgroundVideoPath.trim()
      ? normalizePath(rawRender.backgroundVideoPath.trim())
      : '';
    const srcPath = sourceVideoUrl && sourceVideoUrl.trim()
      ? (sourceVideoUrl.startsWith('http') ? sourceVideoUrl : normalizePath(sourceVideoUrl.trim()))
      : '';

  if (!bgPath && !srcPath) return reject(new Error('A background or source video must be provided.'));

  let nextInputIndex = 0;
  let currentVideo: string;
    const srcHasVideo = srcPath && !srcPath.startsWith('http') ? await hasVideoStream(srcPath) : true;
    const hasSrcVideoFinal = !!srcPath && (srcHasVideo || srcPath.startsWith('http'));
    const shouldApplyDuration = (process.env.FORCE_RENDER_DURATION === '1') || !!opts?.forceDuration || (!hasSrcVideoFinal && !!screenshotPath && screenshotPath.trim().length > 0);

    // Case A: Screenshot overlay (requires background as base)
  if (!srcPath && screenshotPath) {
      if (!bgPath) return reject(new Error('Background video is required for screenshot overlay.'));
      // Input order: background (0), screenshot (1)
      ffmpegCommand.input(bgPath);
      ffmpegCommand.input(normalizePath(screenshotPath));
      const screenshotIndex = 1;
      // 背景は常に全画面フィット
      // 背景: cover（拡大して中央切り抜き）
      complexFilter.push(
        // 背景はカバー（中央切り抜き）
        `[0:v]scale=${videoWidth}:${videoHeight}:force_original_aspect_ratio=increase,crop=${videoWidth}:${videoHeight}:(in_w-${videoWidth})/2:(in_h-${videoHeight})/2,format=yuv420p[bg]`,
        // 前景（Xスクショ）は「フィット（contain）」を基準。上下テロップの安全領域内で scale を適用
        `[${screenshotIndex}:v]scale=${Math.round(videoWidth * scale)}:${Math.round(safeHeight * scale)}:force_original_aspect_ratio=decrease[fg]`,
        // overlay の配置（オーバーレイ位置の反映）
        (() => {
          let yExpr = `${topCaptionHeight}+((H-${topCaptionHeight}-${bottomCaptionHeight}-h)/2)`; // center
          if (overlayPosition === 'top-center') yExpr = `${topCaptionHeight}`;
          else if (overlayPosition === 'bottom-center') yExpr = `H-${bottomCaptionHeight}-h`;
          return `[bg][fg]overlay=(W-w)/2:${yExpr}[base_with_overlay]`;
        })() as unknown as string
      );
      currentVideo = '[base_with_overlay]';
      finalVideoLabel = currentVideo;
      nextInputIndex = 2;
    } else if (srcPath && bgPath) {
      // Case B: 背景の上にソース映像を重ねる（背景が見えるように）
      // Input order: background (0), source (1)
      ffmpegCommand.input(bgPath);
      ffmpegCommand.input(srcPath);
      if (srcHasVideo) {
        complexFilter.push(
          // 背景をcover
          `[0:v]scale=${videoWidth}:${videoHeight}:force_original_aspect_ratio=increase,crop=${videoWidth}:${videoHeight}:(in_w-${videoWidth})/2:(in_h-${videoHeight})/2,format=yuv420p[bg]`,
          // 前景はフィット（contain）基準。上下テロップの安全領域内で scale を適用
          `[1:v]scale=${Math.round(videoWidth * scale)}:${Math.round(safeHeight * scale)}:force_original_aspect_ratio=decrease[fg]`,
          (() => {
            let yExpr = `${topCaptionHeight}+((H-${topCaptionHeight}-${bottomCaptionHeight}-h)/2)`; // center
            if (overlayPosition === 'top-center') yExpr = `${topCaptionHeight}`;
            else if (overlayPosition === 'bottom-center') yExpr = `H-${bottomCaptionHeight}-h`;
            return `[bg][fg]overlay=(W-w)/2:${yExpr}[src_over_bg]`;
          })() as unknown as string
        );
        currentVideo = '[src_over_bg]';
        finalVideoLabel = currentVideo;
      } else {
        // ソースに映像がない場合は背景のみ
        complexFilter.push(
          `[0:v]scale=${videoWidth}:${videoHeight}:force_original_aspect_ratio=increase,crop=${videoWidth}:${videoHeight}:(in_w-${videoWidth})/2:(in_h-${videoHeight})/2,format=yuv420p[base_only]`
        );
        currentVideo = '[base_only]';
        finalVideoLabel = currentVideo;
      }
      nextInputIndex = 2;
    } else {
      // Case C: Single video (source or background only) -> scale + pad
      const single = srcPath || bgPath; // at least one exists here
      ffmpegCommand.input(single);
      complexFilter.push(
        `[0:v]scale=${videoWidth}:${videoHeight}:force_original_aspect_ratio=increase,crop=${videoWidth}:${videoHeight}:(in_w-${videoWidth})/2:(in_h-${videoHeight})/2,format=yuv420p[scaled]`
      );
      currentVideo = '[scaled]';
      finalVideoLabel = currentVideo;
      nextInputIndex = 1;
    }

    // Text with optional full-width caption boxes
    const fontPath = fontFileFromSettings || getDefaultFontPath();
    if (fontPath) {
      log.info('[video-generator] using fontfile:', fontPath);
  const fontOpt = `:fontfile='${escapeFilterPath(fontPath)}'${/\.ttc$/i.test(fontPath) ? ':fontindex=0' : ''}`;
  const boxColor = `${toFfmpegColor(teleTextBg, 'black')}@${captionBgOpacity}`;
      const textColor = toFfmpegColor(captionTextColor, 'white');
  let curr = currentVideo;

      // Compute Y positions for text
  const yTopExpr = yTopExprDefault;
  const yBottomExpr = yBottomExprDefault;

      if (topText && topText.trim().length > 0) {
        // 上テロップ: 文字周りにのみ背景
        const topBoxArgs = `:box=1:boxcolor=${boxColor}:boxborderw=${captionPadding}`;
        complexFilter.push(`${curr}drawtext=text='${topText}':x=(w-text_w)/2:y=${yTopExpr}:fontcolor=${textColor}:fontsize=${topFontSize}${topBoxArgs}${fontOpt}[v_t1]`);
        curr = '[v_t1]';
      }
      if (bottomText && bottomText.trim().length > 0) {
        // 下テロップ: 文字周りにのみ背景（必ず付与）
        const btmBoxArgs = `:box=1:boxcolor=${boxColor}:boxborderw=${captionPadding}`;
        complexFilter.push(`${curr}drawtext=text='${bottomText}':x=(w-text_w)/2:y=${yBottomExpr}:fontcolor=${textColor}:fontsize=${bottomFontSize}${btmBoxArgs}${fontOpt}[v_text_btm]`);
        curr = '[v_text_btm]';
      }
      // Ensure we always end with an explicitly named pad for mapping
      // 強制durationのときはtpadで最後のフレームをクローンして指定秒数まで延長
  if (shouldApplyDuration) {
        complexFilter.push(`${curr}tpad=stop_mode=clone:stop_duration=${durationSec}[v_final]`);
      } else {
        // copy はフィルタではないため null フィルタでラベルを終端に流す
        complexFilter.push(`${curr}null[v_final]`);
      }
      finalVideoLabel = '[v_final]';
    } else {
      log.warn('[video-generator] no fontfile found. Skipping drawtext to avoid fontconfig crash.');
      // Still ensure an explicitly named pad exists
  if (shouldApplyDuration) {
        complexFilter.push(`${currentVideo}tpad=stop_mode=clone:stop_duration=${durationSec}[v_final]`);
      } else {
        // copy はフィルタではないため null フィルタでラベルを終端に流す
        complexFilter.push(`${currentVideo}null[v_final]`);
      }
      finalVideoLabel = '[v_final]';
    }

  // Use semicolons to separate independent filter chains
  const filterGraph = complexFilter.join('; ');
    log.info('[video-generator] filterGraph:', filterGraph);
    log.info('[video-generator] computed:', {
      scale,
      videoWidth,
      videoHeight,
      topCaptionHeight,
      bottomCaptionHeight,
      safeHeight,
      overlayPosition,
    });
  ffmpegCommand.complexFilter(filterGraph);

  // Optional BGM input and audio mapping
    let bgmInputIndex: number | undefined;
    if (rawRender?.bgmPath) {
      ffmpegCommand.input(normalizePath(rawRender.bgmPath));
      bgmInputIndex = nextInputIndex; // after base + optional overlay input(s)
      nextInputIndex += 1;
    }

    ffmpegCommand
      .videoCodec('libx264');

  // Duration の適用ルール:
  // - opts.forceDuration=true のときは常に設定の durationSec を適用（テスト実行用の上限）
  // - それ以外は、スクショ（overlay）の場合のみ durationSec を適用

    // Collect all output options into one list to preserve order
    const outOpts: string[] = [];
    if (shouldApplyDuration) {
      outOpts.push('-t', String(durationSec));
    }
    // 音声が短い場合も5秒まで無音でパディング
    if (shouldApplyDuration) {
      outOpts.push('-af', `apad=pad_dur=${durationSec}`);
    }
    outOpts.push('-preset', getFFmpegPreset(qualityPreset));
    outOpts.push('-pix_fmt', 'yuv420p');
    outOpts.push('-c:a', 'aac');

  // Map audio: prefer source audio when source exists, else background/single input audio
  // Input layout:
  //  - Screenshot overlay: [0]=background, [1]=image -> prefer 0
  //  - Src+Bg overlay: [0]=background, [1]=source -> prefer 1
  //  - Single video (src or bg): [0]=that video -> prefer 0
  // 原動画の音声を優先。背景のみの場合は0
  const preferAudioIndex = srcPath ? (bgPath ? (srcHasVideo ? 1 : 0) : 0) : 0;
  // Explicitly map the final video filter output and audio
  outOpts.push('-map', finalVideoLabel || '[v_final]');
  outOpts.push('-map', `${preferAudioIndex}:a?`);
  // 強制duration時は-video/-audioどちらかが短くても5秒に到達するよう- shortes tは付けない
  ffmpegCommand.outputOptions(outOpts);
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
    };

    // kick async runner
    run().catch((err) => reject(err));
  });
}