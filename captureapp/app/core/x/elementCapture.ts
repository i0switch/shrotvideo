import path from 'path';
import { Page } from 'playwright';
import { ensureDir } from '@core/utils/paths';
import { createLogger } from '@core/logging/logger';

const logger = createLogger('element-capture');

export interface ElementCaptureOptions {
  page: Page;
  selector?: string; // CSS selector for the region (fallback: article video)
  durationMs?: number; // default ~5s
  outDir: string;
  fileName?: string; // mp4
}

// Best-effort fallback: record <video> element via MediaRecorder in page context, then save as webm and transcode to mp4 via ffmpeg pipeline upstream if needed.
export async function recordElementFallback(options: ElementCaptureOptions): Promise<string | undefined> {
  const { page, outDir } = options;
  ensureDir(outDir);
  const fileName = options.fileName ?? 'fallback.webm';
  const outputPath = path.join(outDir, fileName);

  try {
    const durationMs = Math.max(2000, Math.min(15000, options.durationMs ?? 5000));
    const selector = options.selector ?? 'article video, video';

    const chunks: Buffer[] = [];
    // Start recording inside the page; transfer data via evaluateHandle streaming
    const handle = await page.evaluateHandle(async ({ sel, dur }) => {
      const el = (document.querySelector(sel) || document.querySelector('video')) as HTMLVideoElement | null;
      if (!el) throw new Error('no-video-element');
      el.muted = true; try { await el.play(); } catch {}
      // Prefer captureStream from the video element
      const stream = (el as any).captureStream ? (el as any).captureStream() : (el as any).mozCaptureStream?.();
      const ms = stream || (document as any).captureStream?.();
      if (!ms) throw new Error('captureStream-not-supported');
      const recorder = new (window as any).MediaRecorder(ms, { mimeType: 'video/webm;codecs=vp9,opus' });
      const recorded: Blob[] = [];
      recorder.ondataavailable = (e: any) => { if (e.data && e.data.size) recorded.push(e.data); };
      recorder.start(100);
      await new Promise((r) => setTimeout(r, dur));
      recorder.stop();
      await new Promise((r) => (recorder.onstop = r));
      const blob = new Blob(recorded, { type: 'video/webm' });
      const buf = await blob.arrayBuffer();
      return new Uint8Array(buf);
    }, { sel: selector, dur: durationMs });

    const uint8 = (await handle.jsonValue()) as Uint8Array;
    const buf = Buffer.from(uint8);
    await (await import('fs/promises')).writeFile(outputPath, buf);
    logger.info('Element recording fallback saved', { outputPath, bytes: buf.length });
    return outputPath;
  } catch (err) {
    logger.warn('Element recording fallback failed', { message: err instanceof Error ? err.message : String(err) });
    return undefined;
  }
}
