import { describe, it, expect, beforeAll } from 'vitest';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegStatic from 'ffmpeg-static';
import ffprobeStatic from 'ffprobe-static';
import type { AppSettings } from '../../src/core/settings';
import { generateVideo } from '../tasks/video-generator.js';

// Point fluent-ffmpeg to bundled ffmpeg/ffprobe for consistent runs
if (ffmpegStatic) {
  (ffmpeg as unknown as { setFfmpegPath: (p: string) => void }).setFfmpegPath(ffmpegStatic as unknown as string);
}
if (ffprobeStatic) {
  const probePath = (ffprobeStatic as unknown as { path?: string })?.path || (ffprobeStatic as unknown as string);
  if (probePath) (ffmpeg as unknown as { setFfprobePath?: (p: string) => void }).setFfprobePath?.(probePath as string);
}

// Use ASCII-only temp root to avoid any Windows Unicode path issues
const tmpRoot = path.join(os.tmpdir(), 'svt_audio_tests');
const dataDir = path.join(tmpRoot, 'data');
const outDir = path.join(tmpRoot, 'out');

async function ensureDir(p: string) { await fs.mkdir(p, { recursive: true }); }
async function exists(p: string) { try { await fs.stat(p); return true; } catch { return false; } }

describe('audio selection priority (integration)', () => {
  const files = {
    bgSilent: path.join(dataDir, 'bg_silent.mp4'),
    srcWithAudio: path.join(dataDir, 'src_with_audio.mp4'),
    bgm: path.join(dataDir, 'bgm.wav'),
    screenshot: path.join(dataDir, 'screenshot.png'),
  } as const;

  beforeAll(async () => {
    await ensureDir(dataDir);
    await ensureDir(outDir);
    // 1) silent background video (no audio track)
    if (!(await exists(files.bgSilent))) {
      await new Promise<void>((resolve, reject) => {
        ffmpeg()
          .input('color=c=black:s=1080x1920:d=4')
          .inputOptions(['-f', 'lavfi'])
          .outputOptions(['-c:v libx264', '-pix_fmt yuv420p', '-an'])
          .on('end', () => resolve())
          .on('error', reject)
          .save(files.bgSilent);
      });
    }
    // 2) source video with audio (color + sine)
    if (!(await exists(files.srcWithAudio))) {
      await new Promise<void>((resolve, reject) => {
        ffmpeg()
          .input('color=c=blue:s=720x1280:d=4')
          .inputOptions(['-f', 'lavfi'])
          .input('sine=frequency=880:duration=4')
          .inputOptions(['-f', 'lavfi'])
          .outputOptions(['-c:v libx264', '-pix_fmt yuv420p', '-c:a aac', '-shortest'])
          .on('end', () => resolve())
          .on('error', reject)
          .save(files.srcWithAudio);
      });
    }
    // 3) bgm wav
    if (!(await exists(files.bgm))) {
      await new Promise<void>((resolve, reject) => {
        ffmpeg()
          .input('sine=frequency=440:duration=4')
          .inputOptions(['-f', 'lavfi'])
          .outputOptions(['-ac 2', '-ar 48000'])
          .on('end', () => resolve())
          .on('error', reject)
          .save(files.bgm);
      });
    }
    // 4) screenshot png (single frame)
    if (!(await exists(files.screenshot))) {
      await new Promise<void>((resolve, reject) => {
        ffmpeg()
          .input('color=c=white:s=720x1280:d=0.1')
          .inputOptions(['-f', 'lavfi'])
          .outputOptions(['-frames:v 1'])
          .on('end', () => resolve())
          .on('error', reject)
          .save(files.screenshot);
      });
    }
  }, 60_000);

  it('X single-video post: selects src audio first', async () => {
    const settings: AppSettings = {
      general: { outputPath: outDir },
      platforms: { x: { enabled: false, accounts: [], intervalMinutes: 15, scrapeDelayMs: 0 } } as any,
      render: {
        resolution: { width: 1080, height: 1920 },
        durationSec: 4,
        bgmPath: '',
        backgroundVideoPath: files.bgSilent,
        scale: 0.9,
        qualityPreset: 'standard',
        overlayPosition: 'center',
      },
    } as any;

    const out = await generateVideo('', settings, files.srcWithAudio, { accountId: { platform: 'x', id: 'acc' }, sourceType: 'x_tweet_video' });
    const meta = JSON.parse(await fs.readFile(out.replace(/\.mp4$/i, '.meta.json'), 'utf8'));
    expect(meta.ffmpeg.audio.useSynthAudio).toBe(false);
    expect(meta.ffmpeg.audio.selectedKind).toBe('src');
  }, 120_000);

  it('X screenshot (image/text/multi): selects BGM first', async () => {
    const settings: AppSettings = {
      general: { outputPath: outDir },
      platforms: { x: { enabled: false, accounts: [], intervalMinutes: 15, scrapeDelayMs: 0 } } as any,
      render: {
        resolution: { width: 1080, height: 1920 },
        durationSec: 4,
        bgmPath: files.bgm,
        backgroundVideoPath: files.bgSilent,
        scale: 0.9,
        qualityPreset: 'standard',
        overlayPosition: 'center',
      },
    } as any;

    const out = await generateVideo(files.screenshot, settings, undefined, { accountId: { platform: 'x', id: 'acc' }, sourceType: 'screenshot' });
    const meta = JSON.parse(await fs.readFile(out.replace(/\.mp4$/i, '.meta.json'), 'utf8'));
    expect(meta.ffmpeg.audio.useSynthAudio).toBe(false);
    expect(meta.ffmpeg.audio.selectedKind).toBe('bgm');
  }, 120_000);
});
