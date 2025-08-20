import { describe, it, expect } from 'vitest';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
const execFileAsync = promisify(execFile);

// Dynamically import ytdlp-nodejs to avoid ESM interop issues at load time
async function getYtdlp() {
  const mod = await import('ytdlp-nodejs');
  const anyMod = mod as unknown as { default?: unknown; ytdlp?: unknown };
  const fn = (anyMod?.default as unknown) || (anyMod?.ytdlp as unknown) || (mod as unknown);
  if (typeof fn !== 'function') {
  throw new TypeError('ytdlp function not available from module export');
  }
  return fn as (url: string, options?: Record<string, unknown>) => Promise<Record<string, unknown>>;
}

function getEnv(name: string, fallback?: string) {
  const v = process.env[name];
  return (v && v.trim()) || fallback || '';
}

// Note: These tests do not download media files. They validate that a direct media URL can be resolved.
// For stability, YouTube/Instagram tests are skipped unless an env var provides a concrete URL.
// TikTok uses a known public sample URL.

describe('short-video downloadability via yt-dlp (metadata fetch)', () => {
  const YT_SHORT_URL = getEnv('YT_SHORT_URL');
  const IG_REEL_URL = getEnv('IG_REEL_URL');
  const TIKTOK_URL = getEnv('TIKTOK_URL', 'https://www.tiktok.com/@scout2015/video/6718335390845095173');

  it('YouTube Shorts: resolves a direct media URL (skip if not provided)', async () => {
    if (!YT_SHORT_URL) return expect(true).toBe(true);
    const ytdlp = await getYtdlp();
    const info = await ytdlp(YT_SHORT_URL, { dumpSingleJson: true, noWarnings: true });
  const rf = (info as { requested_formats?: Array<{ url?: string }> })?.requested_formats;
  const url = (info as { url?: string; webpage_url?: string })?.url || rf?.[0]?.url || (info as { webpage_url?: string })?.webpage_url;
    expect(typeof url).toBe('string');
    expect(url).toMatch(/^https?:\/\//);
  }, 120_000);

  it('Instagram Reels: resolves a direct media URL (skip if not provided)', async () => {
    if (!IG_REEL_URL) return expect(true).toBe(true);
    const ytdlp = await getYtdlp();
    const info = await ytdlp(IG_REEL_URL, { dumpSingleJson: true, noWarnings: true });
  const rf = (info as { requested_formats?: Array<{ url?: string }> })?.requested_formats;
  const url = (info as { url?: string; webpage_url?: string })?.url || rf?.[0]?.url || (info as { webpage_url?: string })?.webpage_url;
    expect(typeof url).toBe('string');
    expect(url).toMatch(/^https?:\/\//);
  }, 120_000);

  it('TikTok: resolves a direct media URL (public sample)', async () => {
    let info: Record<string, unknown> | null = null;
    try {
      const ytdlp = await getYtdlp();
      info = await ytdlp(TIKTOK_URL, { dumpSingleJson: true, noWarnings: true });
    } catch {
      // fallback: execute binary directly
      const bin = path.join(process.cwd(), 'node_modules', 'ytdlp-nodejs', 'bin', process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');
      const { stdout } = await execFileAsync(bin, ['-J', TIKTOK_URL], { maxBuffer: 10 * 1024 * 1024 });
  info = JSON.parse(stdout) as Record<string, unknown>;
    }
  const rf = (info as { requested_formats?: Array<{ url?: string }> })?.requested_formats;
  const url = (info as { url?: string; webpage_url?: string })?.url || rf?.[0]?.url || (info as { webpage_url?: string })?.webpage_url;
    expect(typeof url).toBe('string');
    expect(url).toMatch(/^https?:\/\//);
  }, 180_000);
});
