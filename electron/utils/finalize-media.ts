import path from 'node:path';
import fs from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import log from 'electron-log';
import ffmpegStatic from 'ffmpeg-static';
import { structuredLog } from './structured-log';
import type { AppSettings, Platform, Account } from '../../src/core/settings';
import { mediaProbe } from './media-probe';

// Core pipeline: input (video or image) -> ensureVideo -> background composite -> chroma composite
// Output: final 1080x1920 MP4 with audio (if present) and chroma foreground overlaid.

interface FinalizeOptions {
  platform: Platform;
  account?: Account | null;
  inputPath: string;          // captured video OR screenshot image path
  outputDir: string;          // final output directory
  settings: AppSettings;      // full settings (for background/chroma defaults)
  forceDurationSec?: number;  // override duration (e.g. test mode)
}

// Pipeline stage identifiers for structured error classification
export enum FinalizeStage {
  Img2Vid = 'img2vid',
  Background = 'background-composite',
  Chroma = 'chroma-composite',
  Probe = 'probe'
}

interface StageErrorInfo {
  stage: FinalizeStage;
  message: string;
  cause?: unknown;
}

export async function finalizeMedia(opts: FinalizeOptions): Promise<string> {
  const { platform, account, inputPath, outputDir, settings, forceDurationSec } = opts;
  const start = Date.now();
  const ffmpegBin = (ffmpegStatic as unknown as string) || 'ffmpeg';
  try { fs.mkdirSync(outputDir, { recursive: true }); } catch { /* ignore */ }
  const workDir = path.join(outputDir, 'work');
  try { fs.mkdirSync(workDir, { recursive: true }); } catch { /* ignore */ }
  structuredLog.emit('pipeline:start', { platform, account: account?.id, input: inputPath, __t0: start });

  const isImage = /\.(png|jpg|jpeg)$/i.test(inputPath);
  let baseVideo = inputPath;
  if (isImage) {
    baseVideo = path.join(workDir, `${Date.now()}-img2vid.mp4`);
    const dur = forceDurationSec || settings.render.durationSec || 3;
    try {
      const t0 = Date.now();
      // 画像→動画: CFR(30fps)でエンコードし、品質プリセットを反映
      const enc = videoEncodeArgs(settings.render.qualityPreset);
      await runFfmpeg(ffmpegBin, [
        '-y','-loop','1','-i', inputPath,
        '-t', String(dur),
        // 画像→動画時に fps を明示しコマ落ち感を排除。必要なら minterpolate で平滑化。
        '-vf','scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30',
        ...enc,
        baseVideo,
      ], FinalizeStage.Img2Vid);
      structuredLog.emit('pipeline:stage-timing', { stage: FinalizeStage.Img2Vid, ms: Date.now()-t0 });
    } catch (e) {
      emitStageError({ stage: FinalizeStage.Img2Vid, message: 'image->video conversion failed', cause: e });
      throw e; // abort pipeline early
    }
  }

  // Probe base video early to know if we actually have an audio stream.
  // これにより後段で不要な空オーディオストリーム生成を避け、BGM自動注入条件 (hasAudio=false) を正しく判定できる。
  let baseHasAudio = false;
  let baseDurationSec = 0;
  try {
    const probe = await mediaProbe(baseVideo);
    baseHasAudio = probe.hasAudio;
    baseDurationSec = Number(probe.durationSec || 0) || 0;
    structuredLog.emit('pipeline:base-probe', { baseVideo, hasAudio: baseHasAudio, durationSec: baseDurationSec, method: probe.method });
  } catch {
    // 非致命的: 失敗時は従来通り想定 (音声不明 → false として扱う)
  }

  // Background video
  const background = await resolveBackground(settings, workDir);
  let chromaAsset = resolveChromaAsset(settings, platform, account);
  // フォールバック: クロマ素材が存在しない場合、作業ディレクトリに緑 (#00FD00) のループ動画を生成
  try {
    const exists = fs.existsSync(chromaAsset);
    if (!exists) {
      const dur = Math.max(1, Math.floor((forceDurationSec || baseDurationSec || settings.render.durationSec || 3)));
      const chromaFallback = path.join(workDir, `${Date.now()}-chroma-fallback.mp4`);
      const ffmpegBin = (ffmpegStatic as unknown as string) || 'ffmpeg';
      // 1080x1920 の #00FD00 単色動画（30fps）を生成
      await runFfmpeg(ffmpegBin, [
        '-y','-f','lavfi','-i','color=c=#00FD00:s=1080x1920',
        '-t', String(dur),
        ...videoEncodeArgs(settings.render.qualityPreset),
        chromaFallback
      ], 'chroma-fallback');
      chromaAsset = chromaFallback;
      structuredLog.emit('pipeline:chroma-fallback-generated', { out: chromaAsset, dur });
    }
  } catch (e) {
    structuredLog.emit('pipeline:chroma-fallback-fail', { err: e instanceof Error ? e.message : String(e) });
  }
  const interVideo = path.join(workDir, `${Date.now()}-inter.mp4`);

  try {
    const t0 = Date.now();
    // 背景合成: CFR(30fps)、品質プリセットを反映。入力に音声があれば AAC で多重化。
    const bgArgs = [
      '-y', '-i', baseVideo, '-i', background,
      // ベース/背景ともに fps=30 を強制し、overlay 前にタイムベースを揃える。
      '-filter_complex', '[0:v]fps=30,scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2,setsar=1[v0];[1:v]fps=30,scale=1080:1920,setsar=1[v1];[v1][v0]overlay=0:0:shortest=1[vout]',
      ...videoEncodeArgs(settings.render.qualityPreset)
    ];
    // 映像はフィルタ出力 [vout] を明示的に採用
    bgArgs.push('-map','[vout]');
    if (baseHasAudio) {
      // 入力に音声がある場合のみ音声ストリームをマップ・再エンコード
      bgArgs.push('-map','0:a?','-c:a','aac','-b:a','128k');
    }
    bgArgs.push('-shortest', interVideo);
    await runFfmpeg(ffmpegBin, bgArgs, FinalizeStage.Background);
    structuredLog.emit('pipeline:stage-timing', { stage: FinalizeStage.Background, ms: Date.now()-t0, baseHasAudio });
  } catch (e) {
    emitStageError({ stage: FinalizeStage.Background, message: 'background composite failed', cause: e });
    throw e;
  }

  // Chroma stage
  const finalOut = path.join(outputDir, `${Date.now()}-final.mp4`);
  const isChromaImage = /\.(png|jpg|jpeg)$/i.test(chromaAsset);
  const chromaLoopArgs = isChromaImage ? ['-loop','1','-i', chromaAsset] : ['-stream_loop','-1','-i', chromaAsset];
  const chromaParams = resolveChromaParams(settings, platform, account || null);
  const { similarity: vSim, blend: vBlend, rawSimilarity, rawBlend, source, clamped } = chromaParams;
  if (clamped.similarity || clamped.blend) {
    structuredLog.emit('pipeline:chroma-param-clamped', { simInput: rawSimilarity, blendInput: rawBlend, sim: vSim, blend: vBlend, source });
  } else {
    structuredLog.emit('pipeline:chroma-param', { sim: vSim, blend: vBlend, source });
  }
  // 一部素材が #00FF00 に近いケースがあるため、二段の colorkey で 00FD00 / 00FF00 両方を抜く
  const filter = '[1:v]format=rgba,scale=1080:1920,colorkey=0x00FD00:' + vSim + ':' + vBlend + "[ck1];" +
                 '[ck1]colorkey=0x00FF00:' + vSim + ':' + vBlend + '[fg];' +
                 '[0:v][fg]overlay=0:0:shortest=1[vout]';
  try {
    const t0 = Date.now();
    // クロマ合成: CFR(30fps)、品質プリセットを反映。ベースに音声があれば AAC を維持。
    // 明示ラベルで両入力に fps=30 を付与し、タイムベースを完全同期させてから overlay
    // 入力0: 背景合成済み interVideo, 入力1: クロマ素材（画像は -loop で供給）
    const chromaFilter = '[0:v]fps=30[vb];' +
                        // 前景チェーンは format/scale/colorkey を維持しつつ fps=30 を適用
                        '[1:v]fps=30,format=rgba,scale=1080:1920,colorkey=0x00FD00:' + vSim + ':' + vBlend + '[ck1];' +
                        '[ck1]colorkey=0x00FF00:' + vSim + ':' + vBlend + '[fg];' +
                        '[vb][fg]overlay=0:0:shortest=1[vout]';
    const chromaArgs = [
      '-y','-i', interVideo, ...chromaLoopArgs,
      '-filter_complex', chromaFilter,
      ...videoEncodeArgs(settings.render.qualityPreset)
    ];
    // 映像はフィルタ出力 [vout] を明示的に採用
    chromaArgs.push('-map','[vout]');
    if (baseHasAudio) {
      chromaArgs.push('-map','0:a?','-c:a','aac','-b:a','128k');
    }
    chromaArgs.push('-shortest', finalOut);
    await runFfmpeg(ffmpegBin, chromaArgs, FinalizeStage.Chroma);
  structuredLog.emit('pipeline:stage-timing', { stage: FinalizeStage.Chroma, ms: Date.now()-t0, sim: vSim, blend: vBlend, baseHasAudio, simSource: source.similarity, blendSource: source.blend });
  } catch (e) {
    emitStageError({ stage: FinalizeStage.Chroma, message: 'chroma composite failed', cause: e });
    // cleanup partial file if created but invalid
    try { if (fs.existsSync(finalOut)) { fs.unlinkSync(finalOut); structuredLog.emit('pipeline:cleanup-partial', { stage: FinalizeStage.Chroma, file: finalOut }); } } catch { /* ignore */ }
    throw e;
  }

  try {
    const pr = await mediaProbe(finalOut);
    structuredLog.emit('pipeline:probe', { platform, account: account?.id, hasAudio: pr.hasAudio, hasVideo: pr.hasVideo, w: pr.width, h: pr.height, dur: pr.durationSec });
    // baseHasAudio=false なのに probe で hasAudio=true の場合は疑似的な空(無音)トラック混入とみなし異常イベントを記録
    if (!baseHasAudio && pr.hasAudio) {
      structuredLog.emit('pipeline:audio-anomaly', { out: finalOut, baseHasAudio, probeHasAudio: pr.hasAudio, method: pr.method });
    }
    // Decide BGM injection based on original baseHasAudio (avoid false positive probe cases where empty audio stream appears)
    const needsBgm = !baseHasAudio;
    if (needsBgm) {
      if (settings.general.autoInjectBgm && settings.render.bgmPath && fs.existsSync(settings.render.bgmPath)) {
        try {
          const t0 = Date.now();
          const withBgm = path.join(workDir, `${Date.now()}-with-bgm.mp4`);
          // ループし最短で切り揃える: BGM 長尺でも問題なし
          const loudnorm = settings.general.bgmLoudnessNormalize ? ['-filter:a','loudnorm=I=-16:TP=-1.5:LRA=11'] : [];
          // 明示的に映像は入力0、音声はBGM入力1を採用
          await runFfmpeg(ffmpegBin, [
            '-y','-i', finalOut,
            '-stream_loop','-1','-i', settings.render.bgmPath,
            '-map','0:v:0','-map','1:a:0',
            '-shortest','-c:v','copy', ...loudnorm, '-c:a','aac', withBgm
          ], 'bgm-inject');
          // 置き換え
            fs.copyFileSync(withBgm, finalOut);
          structuredLog.emit('pipeline:bgm-injected', { out: finalOut, bgm: settings.render.bgmPath, ms: Date.now()-t0 });
          // 再 probe して最終音声確認
          try {
            const pr2 = await mediaProbe(finalOut);
            structuredLog.emit('pipeline:probe-post-bgm', { hasAudio: pr2.hasAudio, dur: pr2.durationSec, method: pr2.method });
          } catch {/* ignore */}
        } catch (e) {
          structuredLog.emit('pipeline:bgm-fail', { out: finalOut, err: e instanceof Error ? e.message : String(e) });
        }
      } else {
        structuredLog.emit('pipeline:warn-no-audio', { out: finalOut, note: 'Output has no audio stream (no BGM injection performed).' });
      }
    }
  } catch (e) {
    emitStageError({ stage: FinalizeStage.Probe, message: 'media probe failed', cause: e });
    // probe失敗は致命的ではないので継続
  }

  // Optional: chroma residue sampling
  // 環境変数 SV_G_CHROMA_RESIDUE_SAMPLE=1 または diagnosticLogging=true のとき有効。
  // SV_G_CHROMA_RESIDUE_FRAMES (>1) 指定で複数フレーム統計 (avg / p95 / max) を計測。
  if (process.env.SV_G_CHROMA_RESIDUE_SAMPLE === '1' || settings.general.diagnosticLogging) {
    const framesEnv = parseInt(process.env.SV_G_CHROMA_RESIDUE_FRAMES || '1', 10);
    const frameCount = Number.isFinite(framesEnv) && framesEnv > 1 ? Math.min(framesEnv, 20) : 1; // 上限 20
    try {
      if (frameCount === 1) {
        const residue = await sampleChromaResidue(finalOut, (ffmpegStatic as unknown as string) || 'ffmpeg');
        if (residue != null) {
          structuredLog.emit('pipeline:chroma-residue', { out: finalOut, ratio: residue.ratio, w: residue.w, h: residue.h });
        }
      } else {
        const residues = await multiSampleChromaResidue(finalOut, (ffmpegStatic as unknown as string) || 'ffmpeg', frameCount);
        if (residues && residues.ratios.length) {
          structuredLog.emit('pipeline:chroma-residue-multi', {
            out: finalOut,
            frames: residues.ratios.length,
            avgRatio: residues.avg,
            p95Ratio: residues.p95,
            maxRatio: residues.max,
            ratios: residues.ratios.slice(0, 10) // ログ肥大防止で先頭10件のみ
          });
        }
      }
    } catch (e) {
      structuredLog.emit('pipeline:chroma-residue-fail', { out: finalOut, err: e instanceof Error ? e.message : String(e), multi: frameCount });
    }
  }
  const totalMs = Date.now()-start;
  structuredLog.emit('pipeline:done', { platform, account: account?.id, out: finalOut, ms: totalMs });
  structuredLog.emit('pipeline:metrics', { platform, account: account?.id, totalMs });
  return finalOut;
}

async function resolveBackground(settings: AppSettings, workDir: string): Promise<string> {
  const requested = settings.render.backgroundVideoPath?.trim();
  const roots = uniqueStrings([
    process.cwd(),
    process.resourcesPath,
    process.resourcesPath ? path.join(process.resourcesPath, 'app') : undefined,
    process.resourcesPath ? path.join(process.resourcesPath, 'app.asar.unpacked') : undefined,
  ]);

  const candidates = uniqueStrings([
    ...collectAssetCandidates(requested, roots),
    ...collectAssetCandidates('haikei.mp4', roots)
  ]);

  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      const stat = fs.existsSync(candidate) ? fs.statSync(candidate) : null;
      if (stat && stat.isFile() && stat.size > 0) return candidate;
    } catch { /* ignore */ }
  }

  const fallback = path.join(workDir, 'haikei-fallback.mp4');
  if (!fs.existsSync(fallback)) {
    try {
      const ffmpegBin = (ffmpegStatic as unknown as string) || 'ffmpeg';
      const res = spawnSync(ffmpegBin, [
        '-y','-f','lavfi','-i','color=c=black:s=1080x1920:d=5',
        '-c:v','libx264','-pix_fmt','yuv420p','-movflags','+faststart', fallback
      ], { stdio: 'ignore' });
      if (res.status !== 0) throw new Error('ffmpeg exited with code ' + res.status);
      structuredLog.emit('pipeline:background-fallback-generated', { out: fallback });
    } catch (e) {
      structuredLog.emit('pipeline:background-fallback-fail', { err: e instanceof Error ? e.message : String(e), requested });
      throw new Error('background asset not found and fallback generation failed');
    }
  }
  return fallback;
}

function collectAssetCandidates(input: string | undefined, roots: Array<string | undefined>): string[] {
  if (!input) return [];
  const trimmed = input.trim();
  if (!trimmed) return [];
  const out: string[] = [];
  if (path.isAbsolute(trimmed)) out.push(trimmed);
  for (const root of roots) {
    if (!root) continue;
    out.push(path.join(root, trimmed));
  }
  return out;
}

function uniqueStrings(values: Array<string | undefined>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (!value) continue;
    if (seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result;
}

type ChromaParamSource = 'account' | 'platform' | 'general' | 'env' | 'default';

interface ResolvedChromaParams {
  similarity: number;
  blend: number;
  rawSimilarity: number;
  rawBlend: number;
  source: { similarity: ChromaParamSource; blend: ChromaParamSource };
  clamped: { similarity: boolean; blend: boolean };
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function pickNumericCandidate(candidates: Array<{ value: number | undefined | null; source: ChromaParamSource }>): { value: number; source: ChromaParamSource } {
  for (const candidate of candidates) {
    if (candidate.value === undefined || candidate.value === null) continue;
    const num = Number(candidate.value);
    if (!Number.isFinite(num)) continue;
    return { value: num, source: candidate.source };
  }
  const fallback = candidates[candidates.length - 1];
  return { value: Number(fallback.value ?? 0), source: fallback.source };
}

export function resolveChromaParams(settings: AppSettings, platform: Platform, account?: Account | null): ResolvedChromaParams {
  const pfChroma = (settings as any)?.platforms?.[platform]?.chroma || {};
  const envSimParsed = parseFloat(process.env.SV_G_CHROMA_SIMILARITY ?? '');
  const envBlendParsed = parseFloat(process.env.SV_G_CHROMA_BLEND ?? '');
  const envSim = Number.isFinite(envSimParsed) ? envSimParsed : undefined;
  const envBlend = Number.isFinite(envBlendParsed) ? envBlendParsed : undefined;

  const { value: rawSimilarity, source: simSource } = pickNumericCandidate([
    { value: account?.chromaSimilarity, source: 'account' },
    { value: pfChroma?.similarity, source: 'platform' },
    { value: settings?.general?.chromaDefaultSimilarity, source: 'general' },
    { value: envSim, source: 'env' },
    { value: 0.25, source: 'default' },
  ]);

  const { value: rawBlend, source: blendSource } = pickNumericCandidate([
    { value: account?.chromaBlend, source: 'account' },
    { value: pfChroma?.blend, source: 'platform' },
    { value: settings?.general?.chromaDefaultBlend, source: 'general' },
    { value: envBlend, source: 'env' },
    { value: 0.05, source: 'default' },
  ]);

  const similarity = clamp01(rawSimilarity);
  const blend = clamp01(rawBlend);

  return {
    similarity,
    blend,
    rawSimilarity,
    rawBlend,
    source: { similarity: simSource, blend: blendSource },
    clamped: { similarity: similarity !== rawSimilarity, blend: blend !== rawBlend },
  };
}

function resolveChromaAsset(settings: AppSettings, platform: Platform, account?: Account | null): string {
  const acc = account?.chromaAsset?.trim();
  if (acc && fs.existsSync(acc)) return acc;
  // Try platform-specific default first
  const pfConf: any = (settings as any)?.platforms?.[platform];
  const pfPath: string | undefined = pfConf?.chroma?.foregroundPath;
  if (pfPath && fs.existsSync(pfPath)) return pfPath;
  // Fallback to generic known assets in project root
  const relPng = path.join(process.cwd(), 'kuroma.png');
  const relMp4 = path.join(process.cwd(), 'kuroma.mp4');
  if (fs.existsSync(relPng)) return relPng;
  if (fs.existsSync(relMp4)) return relMp4;
  return relPng; // final fallback (may not exist)
}

// 映像エンコード共通設定: 品質プリセットに応じて CRF/PRESET を切替
// すべて MP4(H.264/AAC) で CFR(30fps), yuv420p, +faststart を強制
function videoEncodeArgs(quality: AppSettings['render']['qualityPreset']): string[] {
  let crf = '23';
  let preset = 'fast';
  switch (quality) {
    case 'low':
      crf = '28'; preset = 'veryfast';
      break;
    case 'high':
      crf = '18'; preset = 'slow';
      break;
    case 'standard':
    default:
      crf = '23'; preset = 'fast';
  }
  return [
    '-c:v','libx264',
    '-preset', preset,
    '-crf', crf,
    '-pix_fmt','yuv420p',
    '-movflags','+faststart',
    '-r','30',
    '-vsync','cfr'
  ];
}

function runFfmpeg(bin: string, args: string[], phase: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    try {
      const p = spawn(bin, args, { stdio: ['ignore','pipe','pipe'] });
      let stderr = ''; let stdout = '';
      p.stdout.on('data', d => { stdout += d.toString(); });
      p.stderr.on('data', d => { stderr += d.toString(); });
      const timeoutMs = Number(process.env.SV_G_FFMPEG_TIMEOUT_MS || '30000');
      const timer = setTimeout(() => {
        try { p.kill('SIGKILL'); } catch { /* ignore */ }
        structuredLog.emit('pipeline:ffmpeg-timeout', { phase, ms: Date.now()-start });
        reject(new Error('ffmpeg timeout phase=' + phase));
      }, timeoutMs);
      p.on('error', err => { structuredLog.emit('pipeline:ffmpeg-error', { phase, err: err.message }); reject(err); });
      p.on('close', code => {
        clearTimeout(timer);
        const ms = Date.now() - start;
        if (code === 0) {
          structuredLog.emit('pipeline:ffmpeg-ok', { phase, ms });
          resolve();
        } else {
          log.warn(`[pipeline] ffmpeg phase=${phase} exit=${code}`);
          structuredLog.emit('pipeline:ffmpeg-fail', { phase, code, ms, stderr: stderr.slice(0,400) });
          reject(new Error('ffmpeg failed phase=' + phase + ' code=' + code));
        }
      });
    } catch (e) {
      reject(e as Error);
    }
  });
}

function emitStageError(info: StageErrorInfo) {
  structuredLog.emit('pipeline:stage-error', {
    stage: info.stage,
    message: info.message,
    error: info.cause instanceof Error ? info.cause.message : String(info.cause)
  });
}

// Extract first frame (scaled 64x64) and compute chroma green residue ratio.
// Heuristic identical to e2e-chroma test for consistency.
async function sampleChromaResidue(mp4Path: string, ffmpegBin: string): Promise<{ ratio: number; w: number; h: number } | null> {
  const frameSize = 64; // keep tiny
  const args = ['-v','error','-i', mp4Path, '-frames:v','1','-vf',`scale=${frameSize}:${frameSize}:force_original_aspect_ratio=decrease,pad=${frameSize}:${frameSize}:color=black,format=rgb24`,'-f','rawvideo','pipe:1'];
  return new Promise((resolve, reject) => {
    try {
      const p = spawn(ffmpegBin, args, { stdio: ['ignore','pipe','ignore'] });
      const chunks: Buffer[] = [];
      p.stdout.on('data', d => chunks.push(d as Buffer));
      p.on('error', reject);
      p.on('close', code => {
        if (code !== 0) return resolve(null); // non-fatal
        const buf = Buffer.concat(chunks);
        if (!buf.length) return resolve(null);
        const totalPixels = Math.floor(buf.length / 3);
        if (!totalPixels) return resolve(null);
        let greenish = 0;
        for (let i=0; i<buf.length; i+=3) {
          const r = buf[i]; const g = buf[i+1]; const b = buf[i+2];
            if (g > 170 && r < 70 && b < 70 && (g - Math.max(r,b)) > 60) greenish++;
        }
        const ratio = greenish / totalPixels;
        resolve({ ratio, w: frameSize, h: frameSize });
      });
    } catch (e) {
      reject(e);
    }
  });
}

// 複数フレーム版: 指定フレーム数 (最大20) を均等間隔でサンプリングし統計を返す
async function multiSampleChromaResidue(mp4Path: string, ffmpegBin: string, frames: number): Promise<{ ratios: number[]; avg: number; max: number; p95: number } | null> {
  if (frames <= 1) {
    const r = await sampleChromaResidue(mp4Path, ffmpegBin);
    return r ? { ratios: [r.ratio], avg: r.ratio, max: r.ratio, p95: r.ratio } : null;
  }
  // まず duration を取得 (失敗時は連番先頭フレームで妥協)
  let durationSec = 0;
  try { const pr = await mediaProbe(mp4Path); if (pr.durationSec) durationSec = pr.durationSec; } catch {/* ignore */}
  const ratios: number[] = [];
  for (let i = 0; i < frames; i++) {
    // 抽出時間: duration が取れたら均等配置、なければ 0 続き
    const ts = durationSec > 0 ? Math.min(durationSec * (i / (frames - 1)), Math.max(durationSec - 0.05, 0)) : 0;
    const frameSize = 64;
    const args = ['-v','error','-ss', ts.toFixed(3), '-i', mp4Path, '-frames:v','1','-vf',`scale=${frameSize}:${frameSize}:force_original_aspect_ratio=decrease,pad=${frameSize}:${frameSize}:color=black,format=rgb24`,'-f','rawvideo','pipe:1'];
    const ratio = await new Promise<number | null>((resolve) => {
      try {
        const p = spawn(ffmpegBin, args, { stdio: ['ignore','pipe','ignore'] });
        const chunks: Buffer[] = [];
        p.stdout.on('data', d => chunks.push(d as Buffer));
        p.on('close', code => {
          if (code !== 0) return resolve(null);
          const buf = Buffer.concat(chunks);
            if (!buf.length) return resolve(null);
          const totalPixels = Math.floor(buf.length / 3);
          if (!totalPixels) return resolve(null);
          let greenish = 0;
          for (let j=0; j<buf.length; j+=3) {
            const r = buf[j]; const g = buf[j+1]; const b = buf[j+2];
            if (g > 170 && r < 70 && b < 70 && (g - Math.max(r,b)) > 60) greenish++;
          }
          resolve(greenish / totalPixels);
        });
        p.on('error', () => resolve(null));
      } catch {
        resolve(null);
      }
    });
    if (ratio != null) ratios.push(ratio);
  }
  if (!ratios.length) return null;
  const avg = ratios.reduce((a,b)=>a+b,0)/ratios.length;
  const sorted = [...ratios].sort((a,b)=>a-b);
  const p95 = sorted[Math.min(sorted.length-1, Math.floor(sorted.length*0.95))];
  const max = sorted[sorted.length-1];
  return { ratios, avg, max, p95 };
}
