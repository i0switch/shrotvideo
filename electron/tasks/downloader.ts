import path from 'path';
import fs from 'node:fs/promises';
import os from 'node:os';
import log from 'electron-log';
import { app } from 'electron';
import { getYtdlpClient } from './scraper';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execFileAsync = promisify(execFile);
import ffmpegStatic from 'ffmpeg-static';
import ffprobeStatic from 'ffprobe-static';
// Use shared Platform type to avoid circular deps with electron/login
import type { Platform } from '../../src/core/settings';
import { APP, toNetscapeCookie } from '../utils/cookie-utils';
import ffmpeg from 'fluent-ffmpeg';

export interface DownloadResult {
  filepath: string;
  title?: string;
}
// app.asar -> app.asar.unpacked へ解決（存在すればそちらを優先）
function resolvePackedBinary(p: string | undefined | null): string | undefined {
    if (!p) return undefined;
    try {
        let fixed = p as string;
        if (fixed.includes('app.asar\\')) fixed = fixed.replace('app.asar\\', 'app.asar.unpacked\\');
        if (fixed.includes('app.asar/')) fixed = fixed.replace('app.asar/', 'app.asar.unpacked/');
        return fixed;
    } catch { return p || undefined; }
}
// Probe whether file has a video stream
async function hasVideoStream(filePath: string): Promise<boolean> {
    return new Promise((resolve) => {
        try {
            // Ensure ffprobe path is wired when available
            try {
                const probeRaw = ((ffprobeStatic as unknown as { path?: string })?.path || (ffprobeStatic as unknown as string) || '') as string;
                const probeBin = resolvePackedBinary(probeRaw) || probeRaw;
                if (probeBin) {
                    (ffmpeg as unknown as { setFfprobePath?: (p: string) => void }).setFfprobePath?.(probeBin);
                }
            } catch {}
            ffmpeg.ffprobe(filePath, (err, data) => {
                if (err || !data) return resolve(false);
                const v = (data.streams || []).some((s) => String(s.codec_type).toLowerCase() === 'video');
                resolve(v);
            });
        } catch {
            resolve(false);
        }
    });
}



/**
 * Download the best video+audio file for a given page URL using ytdlp-nodejs without permanent install.
 * Returns a local file path suitable for ffmpeg input.
 */
export async function downloadVideoToTemp(pageUrl: string, platform: Platform): Promise<DownloadResult> {
        const { binPath } = await getYtdlpClient();
    const tmpDir = app.getPath('temp');
    // 既存ファイルに対して yt-dlp が "already been downloaded" でスキップするのを避けるため epoch を付与してユニーク化
    const outTmpl = path.join(tmpDir, `svtool-%(id)s-%(epoch)s.%(ext)s`);
  log.info(`[downloader:${platform}] START: url=${pageUrl}`);
    const startTs = Date.now();

  const opts: Record<string, any> = {
    // 1st try: 通常のベスト（mp4優先）
    format: 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best',
    mergeOutputFormat: 'mp4',
    output: outTmpl,
    noPlaylist: true,
    writeThumbnail: false,
    noCheckCertificates: true,
    ffmpegLocation: resolvePackedBinary(ffmpegStatic as unknown as string) || (ffmpegStatic as unknown as string) || undefined,
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36',
  };

  let cookieFilePath: string | undefined;

    if (platform === 'youtube' || platform === 'tiktok' || platform === 'x') {
      try {
          // keytar may be unavailable on some systems; load dynamically
          let keytar: any = null;
          try { keytar = await import('keytar'); } catch { keytar = null; }
          const raw = keytar ? await keytar.getPassword(APP, platform) : null;
          if (raw) {
              const cookies = JSON.parse(raw) as Electron.Cookie[];
              if (cookies.length > 0) {
                  cookieFilePath = path.join(os.tmpdir(), `cookies-${platform}-${Date.now()}.txt`);
                  const cookieFileContent = toNetscapeCookie(cookies);
                  await fs.writeFile(cookieFilePath, cookieFileContent);
                  opts.cookies = cookieFilePath;
                  log.info(`[downloader:${platform}] DEBUG: Using stored cookies from ${cookieFilePath}`);
                  // Log first few lines of cookie file for verification
                  log.info(`[downloader:${platform}] DEBUG: Cookie file content (first 200 chars):
${cookieFileContent.substring(0, 200)}`);
                            } else {
                                log.info(`[downloader:${platform}] DEBUG: No stored cookies found.`);
                            }
                    } else {
                        log.info(`[downloader:${platform}] DEBUG: No raw credential entry found (or keytar not available).`);
                    }
      } catch (e) {
          log.warn(`[downloader:${platform}] WARN: Failed to load cookies`, e);
    }
  }

    log.info(`[downloader:${platform}] DEBUG: ytdlp opts: ${JSON.stringify(opts)}`);

                try {
            let lastErr: unknown;
            const bin = resolvePackedBinary(binPath) || binPath || 'yt-dlp';
            const ua = String(opts.userAgent || 'Mozilla/5.0');
            const ff = resolvePackedBinary(ffmpegStatic as unknown as string) || (ffmpegStatic as unknown as string);
            // 複数フォーマット戦略（映像付き必須）を CLI で直接実行
            const formatTries = [
                'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best',
                'bestvideo[height<=720][ext=mp4]+bestaudio[ext=m4a]/best[height<=720][ext=mp4]/best[height<=720]',
                'bestvideo*+bestaudio/bestvideo/best'
            ];
            for (let i = 0; i < formatTries.length; i++) {
                log.info(`[downloader:${platform}] INFO: Download attempt ${i + 1}/3...`);
                const args: string[] = [
                    pageUrl,
                    '-o', outTmpl,
                    '--merge-output-format', 'mp4',
                    '--format', formatTries[i],
                    '--no-playlist',
                    '--no-check-certificates',
                    '--user-agent', ua,
                    '--verbose'
                ];
                if (platform === 'youtube') {
                    args.push('--extractor-args', 'youtube:player_client=android');
                }
                if (ff) { args.push('--ffmpeg-location', String(ff)); }
                if (cookieFilePath) { args.push('--cookies', cookieFilePath); }
                try {
                    log.info(`[downloader:${platform}] DEBUG: CLI command: ${bin} ${args.join(' ')}`);
                    const { stdout, stderr } = await execFileAsync(bin, args, { windowsHide: true });
                    if (stdout) log.info(`[downloader:${platform}] INFO: CLI stdout: ${stdout}`);
                    if (stderr) log.warn(`[downloader:${platform}] WARN: CLI stderr: ${stderr}`);
                    lastErr = undefined;
                    break;
                } catch (e) {
                    lastErr = e;
                    log.warn(`[downloader:${platform}] WARN: CLI attempt ${i + 1} failed.`, e);
                    await new Promise(r => setTimeout(r, 1000 * (i + 1)));
                }
            }

            if (lastErr) {
                log.error(`[downloader:${platform}] ERROR: All CLI attempts failed.`);
                throw lastErr;
            }

      log.info(`[downloader:${platform}] INFO: Resolving downloaded file path...`);
    let file: string | undefined;
            // 直接パターン一致で候補を探す（IDを含むファイル名のうち最新）
            try {
                const baseId = /([A-Za-z0-9_-]{6,})$/.test(pageUrl) ? pageUrl.split('/').pop()! : undefined;
                if (baseId) {
                    const all = await fs.readdir(tmpDir);
                    const cand = all.filter(n => n.includes(baseId) && n.startsWith('svtool-')).map(n => path.join(tmpDir, n));
                    if (cand.length > 0) {
                        let best: {p: string; t: number} | null = null;
                        for (const p of cand) {
                            try { const st = await fs.stat(p); if (st.isFile() && st.size > 0) { const t = st.mtimeMs; if (!best || t > best.t) best = { p, t }; } } catch {}
                        }
                        if (best) {
                            file = best.p;
                            log.info(`[downloader:${platform}] DEBUG: Found by ID pattern: ${file}`);
                        }
                    }
                }
            } catch {}

            if (!file) {
          log.warn(`[downloader:${platform}] WARN: Could not find file by ID. Falling back to scanning directory.`);
          try {
                            const all = await fs.readdir(tmpDir);
                            const matches = all
                                .filter(n => n.startsWith('svtool-'))
                                .map(n => path.join(tmpDir, n));
              let best: {p: string; t: number; s: number} | null = null;
              // 探索ウィンドウを広げ、直近の svtool-* を優先（古い既存ファイルでも検出できるように）
              const windowStart = startTs - 10 * 60 * 1000; // 10分前まで許容
              for (const p of matches) {
                  try {
                      const st = await fs.stat(p);
                                            if (st.isFile() && st.size > 0 && st.mtimeMs >= windowStart) {
                          const t = st.mtimeMs;
                          if (!best || t > best.t) best = { p, t, s: st.size };
                      }
                  } catch {}
              }
              if (best) {
                file = best.p;
                log.info(`[downloader:${platform}] DEBUG: Found newest matching file: ${file}`);
              }
          } catch (scanErr) {
            log.error(`[downloader:${platform}] ERROR: Failed to scan temp directory.`, scanErr);
          }
      }

      if (!file) {
        log.error(`[downloader:${platform}] ERROR: Downloaded file not found after all checks.`);
        throw new Error('Downloaded file not found.');
      }

                        // Ensure file has a video stream; if not, retry with 720p 優先フォーマット (CLI)
                        if (!(await hasVideoStream(file))) {
                            log.warn(`[downloader:${platform}] WARN: Downloaded file has no video stream. Retrying with 720p-limited format...`);
                            try {
                                const bin2 = resolvePackedBinary(binPath) || binPath || 'yt-dlp';
                                const altFormat = 'bestvideo[height<=720][ext=mp4]+bestaudio[ext=m4a]/best[height<=720][ext=mp4]/best[height<=720]';
                                const args2: string[] = [
                                    pageUrl,
                                    '-o', outTmpl,
                                    '--merge-output-format', 'mp4',
                                    '--format', altFormat,
                                    '--no-playlist',
                                    '--no-check-certificates',
                                    '--user-agent', ua,
                                    '--verbose'
                                ];
                                if (platform === 'youtube') { args2.push('--extractor-args', 'youtube:player_client=android'); }
                                if (ff) { args2.push('--ffmpeg-location', String(ff)); }
                                if (cookieFilePath) { args2.push('--cookies', cookieFilePath); }
                                const { stdout: so2, stderr: se2 } = await execFileAsync(bin2, args2, { windowsHide: true });
                                if (so2) log.info(`[downloader:${platform}] INFO: CLI retry stdout: ${so2}`);
                                if (se2) log.warn(`[downloader:${platform}] WARN: CLI retry stderr: ${se2}`);
                            } catch (e) {
                                log.error(`[downloader:${platform}] ERROR: Retry with 720p format failed.`, e);
                            }
                        }

    log.info(`[downloader:${platform}] SUCCESS: Resolved file path: ${file}`);
    return { filepath: file, title: undefined };
  } finally {
      if (cookieFilePath) {
          try {
              await fs.unlink(cookieFilePath);
              log.info(`[downloader:${platform}] DEBUG: Cleaned up cookie file: ${cookieFilePath}`);
          } catch (e) {
              log.warn(`[downloader:${platform}] WARN: Failed to clean up cookie file: ${cookieFilePath}`, e);
          }
      }
  }
}

/**
 * Download HLS (m3u8) to a temporary MP4 using ffmpeg.
 * Tries stream copy first, then falls back to re-encode for maximum compatibility.
 */
export async function downloadHlsToTemp(hlsUrl: string, userAgent?: string): Promise<DownloadResult> {
    const tmpDir = app.getPath('temp');
    const outPath = path.join(tmpDir, `svtool-hls-${Date.now()}.mp4`);
    try { if (ffmpegStatic) ffmpeg.setFfmpegPath(resolvePackedBinary(ffmpegStatic as unknown as string) || (ffmpegStatic as unknown as string) || undefined as any); } catch {}
    const ua = userAgent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36';

    async function run(copy: boolean): Promise<void> {
        return new Promise((resolve, reject) => {
            const cmd = ffmpeg();
            try { cmd.input(hlsUrl).inputOptions(['-user_agent', ua]); } catch {}
            if (copy) {
                cmd.outputOptions([
                    '-c:v copy',
                    '-c:a aac', // audio may be aac already; ensure consistent mp4
                    '-movflags +faststart',
                    '-preset veryfast',
                ]);
            } else {
                cmd.outputOptions([
                    '-c:v libx264',
                    '-c:a aac',
                    '-pix_fmt yuv420p',
                    '-movflags +faststart',
                    '-preset veryfast',
                ]);
            }
            cmd.on('end', () => resolve())
                 .on('error', (e: Error) => reject(e))
                 .save(outPath);
        });
    }

    try {
        log.info('[downloader:hls] START copy', hlsUrl);
        await run(true);
    } catch (e1) {
        log.warn('[downloader:hls] copy failed; re-encode fallback', (e1 as Error)?.message || String(e1));
        await run(false);
    }
    // Verify it has a video stream
    if (!(await hasVideoStream(outPath))) {
        throw new Error('HLS output has no video stream');
    }
    log.info('[downloader:hls] SUCCESS', outPath);
    return { filepath: outPath };
}
