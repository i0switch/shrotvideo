import ffmpeg from 'fluent-ffmpeg';
import ffmpegStatic from 'ffmpeg-static';
import ffprobeStatic from 'ffprobe-static';
import { app } from 'electron';
import path from 'path';
import log from 'electron-log';
import type { AppSettings } from '../../src/core/settings';
import fs from 'node:fs';

// Utility to normalize path separators for cross-platform compatibility
function normalizePath(p: string): string {
  return p.replace(/\\/g, '/');
}


// 数値の安全評価・フォールバック
function toNumberOr<T extends number>(v: unknown, fallback: T): T {
  const n = Number(v);
  return Number.isFinite(n) ? (n as T) : fallback;
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

// drawtext機能を撤去したため未使用のユーティリティは削除

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
// 色変換もテロップ撤去により不要

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

// フォントサイズ計算も不要

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

// Probe whether file has an audio stream
function hasAudioStream(filePath: string): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      ffmpeg.ffprobe(filePath, (err, data) => {
        if (err || !data) return resolve(false);
        const a = (data.streams || []).some((s) => String((s as { codec_type?: string }).codec_type).toLowerCase() === 'audio');
        resolve(a);
      });
    } catch (e) {
      log.warn(`[downloader] hasAudioStream check failed for ${filePath}`, e);
      resolve(false);
    }
  });
}

// ファイル名用: 不正文字を安全な '_' に置換
function sanitizeFileComponent(s: string): string {
  return s
    .replace(/^@+/, '')
    .replace(/[\\/:*?"<>|\r\n\t]+/g, '_')
    .replace(/\s+/g, '_')
    .slice(0, 200);
}

function formatTimestamp(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const yyyy = d.getFullYear();
  const MM = pad(d.getMonth() + 1);
  const dd = pad(d.getDate());
  const hh = pad(d.getHours());
  const mm = pad(d.getMinutes());
  const ss = pad(d.getSeconds());
  return `${yyyy}${MM}${dd}-${hh}${mm}${ss}`;
}

export function generateVideo(
  screenshotPath: string,
  settings: AppSettings,
  sourceVideoUrl?: string,
  opts?: {
    forceDuration?: boolean;
    accountId?: { platform: string; id: string };
    folderChroma?: { mode?: 'none'|'image'|'video'; image?: string; video?: string };
    // 可観測性: どの経路で生成したかを上位から伝える
  sourceType?: 'x_tweet_overlay' | 'x_tweet_video' | 'youtube' | 'tiktok' | 'screenshot' | 'other';
  }
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
    // Also wire ffprobe binary if available (improves audio/video stream probing reliability)
    try {
      const probeRaw = ((ffprobeStatic as unknown as { path?: string })?.path || (ffprobeStatic as unknown as string) || '') as string;
      const probeBin = resolvePackedBinary(probeRaw) || probeRaw;
      if (probeBin) {
        (ffmpeg as unknown as { setFfprobePath?: (p: string) => void }).setFfprobePath?.(probeBin);
      }
    } catch { /* ignore */ }
    const { render: rawRender, general } = settings;
    const videoWidth = toNumberOr(rawRender?.resolution?.width, 1080);
    const videoHeight = toNumberOr(rawRender?.resolution?.height, 1920);
  // スケールは 1.0 を上限（1=画面の安全領域にピッタリ収まる）
  const scale = clamp(toNumberOr(rawRender?.scale, 0.8), 0.05, 1.0);
  // テロップ関連は撤去
    const durationSec = Math.max(1, toNumberOr(rawRender?.durationSec, 15));
    const overlayPosition = (rawRender?.overlayPosition as 'center' | 'top-center' | 'bottom-center' | 'custom') || 'center';
    const qualityPreset = (rawRender?.qualityPreset as 'low' | 'standard' | 'high' | string) || 'standard';
    

  const startedAt = Date.now();
  // 出力ファイル名: プラットフォーム名＿アカウント名＿生成時間.mp4（全角アンダースコア）
  const accountPlatform = (opts?.accountId?.platform || 'unknown').toLowerCase();
  const accountName = opts?.accountId?.id ? String(opts.accountId.id) : 'unknown';
  const platformPart = sanitizeFileComponent(accountPlatform || 'unknown');
  const accountPart = sanitizeFileComponent(accountName || 'unknown');
  const tsPart = formatTimestamp(new Date(startedAt));
  const fullWidthUnderscore = '＿';
  const outputFileName = `${platformPart}${fullWidthUnderscore}${accountPart}${fullWidthUnderscore}${tsPart}.mp4`;
    const outputPath = normalizePath(path.join(general.outputPath, outputFileName));
    // Ensure output directory exists
    try {
      const outDir = path.dirname(outputPath);
      if (!fs.existsSync(outDir)) {
        fs.mkdirSync(outDir, { recursive: true });
      }
    } catch (e) {
      log.warn(`[video-generator] Failed to ensure output directory exists: ${e instanceof Error ? e.message : String(e)}`);
    }

    log.info(`Starting video generation. Output: ${outputPath}`);

    // テロップ安全領域・ボックス類を撤去。前景のフィット領域は画面全体を基準にする
    const safeHeight = Math.max(1, videoHeight);

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
  // Track input indices for audio selection
  let bgInputIndex: number | undefined;
  let srcInputIndex: number | undefined;
    const srcHasVideo = srcPath && !srcPath.startsWith('http') ? await hasVideoStream(srcPath) : true;
    const hasSrcVideoFinal = !!srcPath && (srcHasVideo || srcPath.startsWith('http'));
  const shouldApplyDuration = (process.env.FORCE_RENDER_DURATION === '1') || !!opts?.forceDuration || (!hasSrcVideoFinal && !!screenshotPath && screenshotPath.trim().length > 0);

    // Utility: decide chroma overlay material based on folder override or account settings
    const chroma = (() => {
      try {
        // Highest priority: folder-level override
        if (opts?.folderChroma && opts.folderChroma.mode) {
          return { mode: (opts.folderChroma.mode || 'none') as 'none'|'image'|'video', folderOverride: true } as const;
        }
        const platform = opts?.accountId?.platform as 'x'|'tiktok'|'youtube'|undefined;
        const id = opts?.accountId?.id;
        if (!platform || !id) return { mode: 'none' as const };
        const acc = (settings.platforms as any)?.[platform]?.accounts?.find((a: any) => a.id === id);
        const mode = (acc?.chromaMode || 'none') as 'none'|'image'|'video';
        return { mode };
      } catch { return { mode: 'none' as const }; }
    })();

    // クロマキー素材ファイル: 未指定時は適用しない（プロジェクトルートのデフォルトは使わない）
    let chromaImage: string | undefined;
    let chromaVideo: string | undefined;
    try {
      if (opts?.folderChroma && opts.folderChroma.mode) {
        if (opts.folderChroma.image && typeof opts.folderChroma.image === 'string' && opts.folderChroma.image.trim()) {
          const p = normalizePath(opts.folderChroma.image.trim());
          if (fs.existsSync(p)) chromaImage = p;
        }
        if (opts.folderChroma.video && typeof opts.folderChroma.video === 'string' && opts.folderChroma.video.trim()) {
          const p = normalizePath(opts.folderChroma.video.trim());
          if (fs.existsSync(p)) chromaVideo = p;
        }
      } else {
        const platform = opts?.accountId?.platform as 'x'|'tiktok'|'youtube'|undefined;
        const id = opts?.accountId?.id;
        if (platform && id) {
          const acc = (settings.platforms as any)?.[platform]?.accounts?.find((a: any) => a.id === id);
          if (acc?.chromaImagePath && typeof acc.chromaImagePath === 'string' && acc.chromaImagePath.trim()) {
            const p = normalizePath(acc.chromaImagePath.trim());
            if (fs.existsSync(p)) chromaImage = p;
          }
          if (acc?.chromaVideoPath && typeof acc.chromaVideoPath === 'string' && acc.chromaVideoPath.trim()) {
            const p = normalizePath(acc.chromaVideoPath.trim());
            if (fs.existsSync(p)) chromaVideo = p;
          }
        }
      }
    } catch { /* ignore */ }
  const chromaKey = '0x00FD00'; // #00FD00（既定のキーカラー）
  // クロマキー閾値は素材タイプ別に少し寛容にする（動画は圧縮の色ずれを考慮）
  const chromaSimImg = 0.12; // 類似度（画像）
  const chromaBlendImg = 0.08; // ブレンド（画像）
  const chromaSimVid = 0.28; // 類似度（動画）
  const chromaBlendVid = 0.10; // ブレンド（動画）

    // Case A: Screenshot overlay (requires background as base)
  if (!srcPath && screenshotPath) {
      if (!bgPath) return reject(new Error('Background video is required for screenshot overlay.'));
      // Input order: background (0), screenshot (1)
    ffmpegCommand.input(bgPath);
    bgInputIndex = 0;
    nextInputIndex = 1;
    ffmpegCommand.input(normalizePath(screenshotPath));
    const screenshotIndex = 1;
    nextInputIndex = 2;
      // 背景は常に全画面フィット
      // 背景: cover（拡大して中央切り抜き）
      complexFilter.push(
        // 背景はカバー（中央切り抜き）
        `[0:v]scale=${videoWidth}:${videoHeight}:force_original_aspect_ratio=increase,crop=${videoWidth}:${videoHeight}:(in_w-${videoWidth})/2:(in_h-${videoHeight})/2,format=yuv420p[bg]`,
        // 前景（Xスクショ）は「フィット（contain）」を基準。上下テロップの安全領域内で scale を適用
        `[${screenshotIndex}:v]scale=${Math.round(videoWidth * scale)}:${Math.round(safeHeight * scale)}:force_original_aspect_ratio=decrease[fg]`,
        // overlay の配置（オーバーレイ位置の反映）
        (() => {
          const pos = getOverlayPosition(overlayPosition, videoWidth, videoHeight, scale);
          return `[bg][fg]overlay=${pos}[base_with_overlay]`;
        })() as unknown as string
      );
      // ここにクロマキー合成（アカウント指定時）
  if (chroma.mode === 'image' && chromaImage && fs.existsSync(chromaImage)) {
        const idx = nextInputIndex; // use next slot for chroma image
        ffmpegCommand.input(chromaImage);
        nextInputIndex++;
        complexFilter.push(
          // 画像は RGBA 化してから chromakey を適用（アルファ合成の安定化）
          `[${idx}:v]scale=${videoWidth}:${videoHeight}:force_original_aspect_ratio=decrease,format=rgba,chromakey=${chromaKey}:${chromaSimImg}:${chromaBlendImg},format=rgba[keyed]`,
          // shortest=0 で前景の終了でミキシングが止まらないようにする（画像は最後のフレーム保持）
          `[base_with_overlay][keyed]overlay=(W-w)/2:(H-h)/2:shortest=0[chroma_applied]`
        );
        currentVideo = '[chroma_applied]';
  } else if (chroma.mode === 'video' && chromaVideo && fs.existsSync(chromaVideo)) {
        // 動画は RGBA 化して chromakey、さらに最終長に足りない場合のため tpad で末尾クローン
        const idx = nextInputIndex; // use next slot for chroma video
        ffmpegCommand.input(chromaVideo);
        nextInputIndex++;
        try { ffmpegCommand.inputOptions([`-stream_loop`, `-1`]); } catch {/* ignore */}
        complexFilter.push(
          `[${idx}:v]scale=${videoWidth}:${videoHeight}:force_original_aspect_ratio=decrease,format=rgba,chromakey=${chromaKey}:${chromaSimVid}:${chromaBlendVid},format=rgba${shouldApplyDuration ? `,tpad=stop_mode=clone:stop_duration=${durationSec}` : ''}[keyed]`,
          `[base_with_overlay][keyed]overlay=(W-w)/2:(H-h)/2:shortest=0[chroma_applied]`
        );
        currentVideo = '[chroma_applied]';
      } else {
        currentVideo = '[base_with_overlay]';
      }
      finalVideoLabel = currentVideo;
      // nextInputIndex already reflects added inputs
    } else if (srcPath && bgPath) {
      // Case B: 背景の上にソース映像を重ねる（背景が見えるように）
      // Input order: background (0), source (1)
      ffmpegCommand.input(bgPath); bgInputIndex = 0; nextInputIndex = 1;
      ffmpegCommand.input(srcPath); srcInputIndex = 1; nextInputIndex = 2;
      if (srcHasVideo) {
        complexFilter.push(
          // 背景をcover
          `[0:v]scale=${videoWidth}:${videoHeight}:force_original_aspect_ratio=increase,crop=${videoWidth}:${videoHeight}:(in_w-${videoWidth})/2:(in_h-${videoHeight})/2,format=yuv420p[bg]`,
          // 前景はフィット（contain）基準。上下テロップの安全領域内で scale を適用
          `[1:v]scale=${Math.round(videoWidth * scale)}:${Math.round(safeHeight * scale)}:force_original_aspect_ratio=decrease[fg]`,
          (() => {
            const pos = getOverlayPosition(overlayPosition, videoWidth, videoHeight, scale);
            return `[bg][fg]overlay=${pos}[src_over_bg]`;
          })() as unknown as string
        );
        // ここにクロマキー合成（アカウント指定時）
        if (chroma.mode === 'image' && chromaImage && fs.existsSync(chromaImage)) {
          const idx = nextInputIndex;
          ffmpegCommand.input(chromaImage);
          nextInputIndex++;
          complexFilter.push(
            `[${idx}:v]scale=${videoWidth}:${videoHeight}:force_original_aspect_ratio=decrease,format=rgba,chromakey=${chromaKey}:${chromaSimImg}:${chromaBlendImg},format=rgba[keyed]`,
            `[src_over_bg][keyed]overlay=(W-w)/2:(H-h)/2:shortest=0[chroma_applied]`
          );
          currentVideo = '[chroma_applied]';
        } else if (chroma.mode === 'video' && chromaVideo && fs.existsSync(chromaVideo)) {
          const idx = nextInputIndex;
          ffmpegCommand.input(chromaVideo);
          nextInputIndex++;
          try { ffmpegCommand.inputOptions([`-stream_loop`, `-1`]); } catch {/* ignore */}
          complexFilter.push(
            `[${idx}:v]scale=${videoWidth}:${videoHeight}:force_original_aspect_ratio=decrease,format=rgba,chromakey=${chromaKey}:${chromaSimVid}:${chromaBlendVid},format=rgba${shouldApplyDuration ? `,tpad=stop_mode=clone:stop_duration=${durationSec}` : ''}[keyed]`,
            `[src_over_bg][keyed]overlay=(W-w)/2:(H-h)/2:shortest=0[chroma_applied]`
          );
          currentVideo = '[chroma_applied]';
        } else {
          currentVideo = '[src_over_bg]';
        }
        finalVideoLabel = currentVideo;
      } else {
        // ソースに映像がない場合は背景のみ
        complexFilter.push(
          `[0:v]scale=${videoWidth}:${videoHeight}:force_original_aspect_ratio=increase,crop=${videoWidth}:${videoHeight}:(in_w-${videoWidth})/2:(in_h-${videoHeight})/2,format=yuv420p[base_only]`
        );
        currentVideo = '[base_only]';
        finalVideoLabel = currentVideo;
      }
      // nextInputIndex already reflects added inputs
    } else {
      // Case C: Single video (source or background only) -> scale + pad
      const single = srcPath || bgPath; // at least one exists here
      ffmpegCommand.input(single);
      if (single === srcPath) { srcInputIndex = 0; } else { bgInputIndex = 0; }
      nextInputIndex = 1;
      complexFilter.push(
        `[0:v]scale=${videoWidth}:${videoHeight}:force_original_aspect_ratio=increase,crop=${videoWidth}:${videoHeight}:(in_w-${videoWidth})/2:(in_h-${videoHeight})/2,format=yuv420p[scaled]`
      );
      // シングル動画の上にクロマキー可能
      if (chroma.mode === 'image' && chromaImage && fs.existsSync(chromaImage)) {
        const idx = nextInputIndex;
        ffmpegCommand.input(chromaImage);
        nextInputIndex++;
        complexFilter.push(
          `[${idx}:v]scale=${videoWidth}:${videoHeight}:force_original_aspect_ratio=decrease,format=rgba,chromakey=${chromaKey}:${chromaSimImg}:${chromaBlendImg},format=rgba[keyed]`,
          `[scaled][keyed]overlay=(W-w)/2:(H-h)/2:shortest=0[chroma_applied]`
        );
        currentVideo = '[chroma_applied]';
      } else if (chroma.mode === 'video' && chromaVideo && fs.existsSync(chromaVideo)) {
        const idx = nextInputIndex;
        ffmpegCommand.input(chromaVideo);
        nextInputIndex++;
        try { ffmpegCommand.inputOptions([`-stream_loop`, `-1`]); } catch {/* ignore */}
        complexFilter.push(
          `[${idx}:v]scale=${videoWidth}:${videoHeight}:force_original_aspect_ratio=decrease,format=rgba,chromakey=${chromaKey}:${chromaSimVid}:${chromaBlendVid},format=rgba${shouldApplyDuration ? `,tpad=stop_mode=clone:stop_duration=${durationSec}` : ''}[keyed]`,
          `[scaled][keyed]overlay=(W-w)/2:(H-h)/2:shortest=0[chroma_applied]`
        );
        currentVideo = '[chroma_applied]';
      } else {
        currentVideo = '[scaled]';
      }
      finalVideoLabel = currentVideo;
      // nextInputIndex already reflects added inputs
    }

    // テキスト描画を全撤去。finalVideoLabel を currentVideo から直接作る
    if (shouldApplyDuration) {
      complexFilter.push(`${currentVideo}tpad=stop_mode=clone:stop_duration=${durationSec}[v_final]`);
    } else {
      complexFilter.push(`${currentVideo}null[v_final]`);
    }
    finalVideoLabel = '[v_final]';

  // フィルタグラフの適用は、後段で「無音合成」を追加する可能性があるため、
  // オーディオ選択確定後に行う。

  // Optional BGM input (added for potential fallback)
    let bgmInputIndex: number | undefined;
    if (rawRender?.bgmPath) {
      ffmpegCommand.input(normalizePath(rawRender.bgmPath));
      bgmInputIndex = nextInputIndex; // after base + optional overlay input(s)
      nextInputIndex += 1;
    }

    // Collect all output options into one list to preserve order
    const outOpts: string[] = [];
    if (shouldApplyDuration) {
      outOpts.push('-t', String(durationSec));
    }
    outOpts.push('-preset', getFFmpegPreset(qualityPreset));
    outOpts.push('-pix_fmt', 'yuv420p');

    // Decide audio source strictly per spec
    const platform = (opts?.accountId?.platform || '').toLowerCase();
    const sourceType = opts?.sourceType || (srcPath ? 'other' : (screenshotPath ? 'screenshot' : 'other'));
    // Probe audio availability for local files (http assumed to have audio)
    const srcHasAudio = (srcInputIndex !== undefined) && (srcPath && srcPath.startsWith('http') ? true : (srcPath ? await hasAudioStream(srcPath) : false));
    const bgHasAudio = (bgInputIndex !== undefined) && (bgPath ? (bgPath.startsWith('http') ? true : await hasAudioStream(bgPath)) : false);

    let selectedAudioIndex: number | undefined;
    const isX = platform === 'x';
    const isTikTok = platform === 'tiktok';
    const isYouTube = platform === 'youtube';

    if (isTikTok || isYouTube) {
      // TikTok, YouTube: ①src → ②BGM → ③背景 → ④無音
      if (srcHasAudio && srcInputIndex !== undefined) selectedAudioIndex = srcInputIndex;
      else if (bgmInputIndex !== undefined) selectedAudioIndex = bgmInputIndex;
      else if (bgHasAudio && bgInputIndex !== undefined) selectedAudioIndex = bgInputIndex;
    } else if (isX) {
      // X: 単一動画ポスト → ①src → ②BGM → ③背景 → ④無音
      //     画像/文章/複数メディア → ①BGM → ②背景 → ③無音
  const isSingleVideo = sourceType === 'x_tweet_video' || (sourceType === 'x_tweet_overlay' && !!srcHasVideo);
      if (isSingleVideo) {
        if (srcHasAudio && srcInputIndex !== undefined) selectedAudioIndex = srcInputIndex;
        else if (bgmInputIndex !== undefined) selectedAudioIndex = bgmInputIndex;
        else if (bgHasAudio && bgInputIndex !== undefined) selectedAudioIndex = bgInputIndex;
      } else {
        if (bgmInputIndex !== undefined) selectedAudioIndex = bgmInputIndex;
        else if (bgHasAudio && bgInputIndex !== undefined) selectedAudioIndex = bgInputIndex;
      }
    } else {
      // その他: ①src → ②BGM → ③背景 → ④無音
      if (srcHasAudio && srcInputIndex !== undefined) selectedAudioIndex = srcInputIndex;
      else if (bgmInputIndex !== undefined) selectedAudioIndex = bgmInputIndex;
      else if (bgHasAudio && bgInputIndex !== undefined) selectedAudioIndex = bgInputIndex;
    }

    // 最終的に音声が選べなければ、完全無音のステレオトラックを合成
    const useSynthAudio = (selectedAudioIndex === undefined);
    if (useSynthAudio) {
      complexFilter.push(`anullsrc=r=48000:cl=stereo[a_synth]`);
      log.warn('[video-generator] no audio input detected; injecting synthetic silent audio track');
    }

    // ここでフィルタグラフを確定し適用
    const filterGraph = complexFilter.join('; ');
    log.info('[video-generator] filterGraph:', filterGraph);
    log.info('[video-generator] computed:', { scale, videoWidth, videoHeight, safeHeight, overlayPosition, chroma: { mode: chroma.mode, hasImage: !!chromaImage, hasVideo: !!chromaVideo } });
    ffmpegCommand.complexFilter(filterGraph);

    ffmpegCommand
      .videoCodec('libx264');

  // Duration の適用ルール:
  // - opts.forceDuration=true のときは常に設定の durationSec を適用（テスト実行用の上限）
  // - それ以外は、スクショ（overlay）の場合のみ durationSec を適用

    

    // Map video always
    outOpts.push('-map', finalVideoLabel || '[v_final]');

  if (!useSynthAudio && selectedAudioIndex !== undefined) {
      const selectedKind = ((): 'src'|'bgm'|'bg' => {
        if (bgmInputIndex !== undefined && selectedAudioIndex === bgmInputIndex) return 'bgm';
        if (srcInputIndex !== undefined && selectedAudioIndex === srcInputIndex) return 'src';
        return 'bg';
      })();
      log.info(`[video-generator] selected audio: ${selectedKind} (platform=${platform || 'n/a'})`);
      outOpts.push('-map', `${selectedAudioIndex}:a?`);
      outOpts.push('-c:a', 'aac');
      // Pad audio to duration only when we have an audio stream
      if (shouldApplyDuration) {
        outOpts.push('-af', `apad=pad_dur=${durationSec}`);
      }
    } else {
      // 合成無音トラックをマップ
      outOpts.push('-map', `[a_synth]`);
      outOpts.push('-c:a', 'aac');
      // 注意: [a_synth] は filter_complex から供給されるため、ここで -af は付けない。
      // 長さは -t（出力全体の制限）および動画側の tpad で制御される。
    }

    // 強制duration時は-video/-audioどちらかが短くても5秒に到達するよう- shortest は付けない
    // テスト互換性のため、出力オプションはフラグごとに分割して追加する（'-map [v_final]' 等が単一呼び出しで記録されるように）
    const pairFlags = new Set(['-t', '-preset', '-pix_fmt', '-map', '-c:a', '-af']);
    for (let i = 0; i < outOpts.length; ) {
      const flag = outOpts[i];
      if (pairFlags.has(flag) && i + 1 < outOpts.length) {
        // 個別に渡す（テストで '-map [v_final]' を検出しやすくする）
        ffmpegCommand.outputOptions(flag as any);
        ffmpegCommand.outputOptions(outOpts[i + 1] as any);
        i += 2;
      } else {
        ffmpegCommand.outputOptions(flag as any);
        i += 1;
      }
    }

    // メタ情報のJSON出力は既定で無効化（ENABLE_META_JSON=1 のときのみ書き出し）
    const baseMeta: Record<string, any> = {
      version: 1,
      startedAt,
      output: outputPath,
      platform,
      accountId: opts?.accountId?.id || null,
      sourceType: opts?.sourceType || (srcPath ? 'other' : (screenshotPath ? 'screenshot' : 'other')),
      inputs: {
        background: bgPath || null,
        source: srcPath || null,
        screenshot: screenshotPath || null,
        bgm: rawRender?.bgmPath || null,
        chroma: { mode: chroma.mode, image: chromaImage || null, video: chromaVideo || null },
      },
      ffmpeg: {
        filterGraph,
        shouldApplyDuration,
        durationSec,
        preset: getFFmpegPreset(qualityPreset),
        audio: {
          useSynthAudio,
          selectedIndex: selectedAudioIndex ?? null,
          selectedKind: (() => {
            if (useSynthAudio) return 'synth';
            if (selectedAudioIndex === undefined) return null;
            if (bgmInputIndex !== undefined && selectedAudioIndex === bgmInputIndex) return 'bgm';
            if (srcInputIndex !== undefined && selectedAudioIndex === srcInputIndex) return 'src';
            if (bgInputIndex !== undefined && selectedAudioIndex === bgInputIndex) return 'bg';
            return 'unknown';
          })(),
          // 診断用: 検出結果を残す
          probed: {
            srcHasAudio,
            bgHasAudio,
            bgmPresent: bgmInputIndex !== undefined,
          },
          synth: useSynthAudio ? { mode: 'silent' } : null,
        },
      },
    };

    const shouldWriteMeta = process.env.ENABLE_META_JSON === '1';
    const writeMeta = (meta: Record<string, any>) => {
      if (!shouldWriteMeta) return; // 出力しない
      try {
        const metaPath = outputPath.replace(/\.mp4$/i, '.meta.json');
        const dir = path.dirname(outputPath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf8');
      } catch (e) {
        log.warn('[video-generator] failed to write meta json:', e instanceof Error ? e.message : String(e));
      }
    };

    ffmpegCommand
      .on('start', (commandLine) => {
        log.info('Spawned Ffmpeg with command: ' + commandLine);
      })
      .on('end', () => {
        const endedAt = Date.now();
        const meta = {
          ...baseMeta,
          endedAt,
          durationMs: Math.max(0, endedAt - startedAt),
          status: 'success',
        };
        writeMeta(meta);
        log.info(`Video generation finished successfully: ${outputPath}`);
        resolve(outputPath);
      })
      .on('error', (err, stdout, stderr) => {
        log.error(`Error during video generation: ${err.message}`);
        log.error('ffmpeg stdout:\n' + stdout);
        log.error('ffmpeg stderr:\n' + stderr);
        try {
          const endedAt = Date.now();
          const meta = {
            ...baseMeta,
            endedAt,
            durationMs: Math.max(0, endedAt - startedAt),
            status: 'error',
            error: err?.message || String(err),
          };
          writeMeta(meta);
        } catch {/* ignore */}
        reject(err);
      })
      .save(outputPath);
    };

    // kick async runner
    run().catch((err) => reject(err));
  });
}