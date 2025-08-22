import path from 'path';
import fs from 'node:fs/promises';
import log from 'electron-log';
import { app } from 'electron';
import { getYtdlpClient } from './scraper.js';
import ffmpegStatic from 'ffmpeg-static';

export interface DownloadResult {
  filepath: string;
  title?: string;
}

/**
 * Download the best video+audio file for a given page URL using ytdlp-nodejs without permanent install.
 * Returns a local file path suitable for ffmpeg input.
 */
export async function downloadVideoToTemp(pageUrl: string): Promise<DownloadResult> {
  const { yt } = await getYtdlpClient();
  const tmpDir = app.getPath('temp');
  const outTmpl = path.join(tmpDir, `svtool-%(id)s.%(ext)s`);
  log.info(`[downloader] start: ${pageUrl}`);
  // ytdlp-nodejs downloadAsync writes file when -o is provided via options
  const opts = {
    // best mp4 video+audio, merge into mp4. See: https://github.com/yt-dlp/yt-dlp#format-selection-examples
    format: 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best',
    mergeOutputFormat: 'mp4',
    output: outTmpl,
    noPlaylist: true,
    writeThumbnail: false,
    noCheckCertificates: true,
    ffmpegLocation: (ffmpegStatic as unknown as string) || undefined,
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36',
    impersonate: ['chrome'] as string[],
  } as const;
  // simple retry 2x
  let lastErr: unknown;
  for (let i = 0; i < 2; i++) {
    try {
      await yt.downloadAsync(pageUrl, opts as any);
      lastErr = undefined;
      break;
    } catch (e) {
      lastErr = e;
      log.warn(`[downloader] retry ${i + 1} after error: ${(e as Error).message || String(e)}`);
      await new Promise(r => setTimeout(r, 1000 * (i + 1)));
    }
  }
  if (lastErr) throw lastErr;
  // Find the produced file by probing template with info
  const info = await yt.getInfoAsync(pageUrl, { skipDownload: true, noCheckCertificates: true, userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36', impersonate: ['chrome'] });
  const id = (info as any)?.id;
  const ext = 'mp4';
  const file = path.join(tmpDir, `svtool-${id}.${ext}`);
  log.info(`[downloader] done: ${file}`);
  return { filepath: file, title: (info as any)?.title };
}
