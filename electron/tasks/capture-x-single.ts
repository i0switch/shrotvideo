import { structuredLog } from '../utils/structured-log';

export async function captureSingleXVideo(opts: { tweetUrl: string; outDir: string; debugFile?: string }): Promise<any> {
  structuredLog.emit('capture-x-single:start', { url: opts.tweetUrl });
  // Minimal stub: indicate unplayable so upstream falls back to screenshot flow
  return { kind: 'unplayable', reason: 'stub-not-implemented' };
}
