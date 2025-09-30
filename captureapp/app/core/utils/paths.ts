import path from 'path';
import fs from 'fs';

export function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export function resolveOutputs(baseDir: string, tweetId: string) {
  const runDir = path.resolve(baseDir);
  ensureDir(runDir);
  const postDir = path.join(runDir, tweetId);
  ensureDir(postDir);
  return { runDir, postDir };
}

export function safeFilename(input: string) {
  return input.replace(/[^a-z0-9\-_.]/gi, '_');
}
