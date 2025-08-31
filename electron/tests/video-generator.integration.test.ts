import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import { generateVideo } from '../tasks/video-generator.js';
import type { AppSettings } from '../../src/core/settings';
import ffmpeg from 'fluent-ffmpeg';
// Point fluent-ffmpeg to a known ffmpeg binary (bundled)
import ffmpegStatic from 'ffmpeg-static';
if (ffmpegStatic) {
  (ffmpeg as unknown as { setFfmpegPath: (p: string) => void }).setFfmpegPath(ffmpegStatic as unknown as string);
}

// Create a temporary ASCII-only directory to avoid ffmpeg issues with spaces/Unicode in paths on Windows
const tmpRoot = path.join(os.tmpdir(), 'svt_tests');
const testData = path.join(tmpRoot, 'data');
const outDir = path.join(tmpRoot, 'out');

const baseSettings: AppSettings = {
  general: {
    outputPath: outDir,
  },
  platforms: { x: { enabled: false, accounts: [], intervalMinutes: 15, scrapeDelayMs: 0 }, tiktok: { enabled: false, accounts: [], intervalMinutes: 15, scrapeDelayMs: 0 }, youtube: { enabled: false, accounts: [], intervalMinutes: 15, scrapeDelayMs: 0 } },
  render: {
    resolution: { width: 1080, height: 1920 },
    durationSec: 5, // keep short for tests
  bgmPath: path.join(testData, 'bgm.wav'),
    backgroundVideoPath: path.join(testData, 'background.mp4'),
    captions: { top: 'INTEGRATION_TOP', bottom: 'INTEGRATION_BOTTOM' },
    scale: 0.8,
    teleTextBg: '#000000',
    qualityPreset: 'standard',
    overlayPosition: 'center',
    topCaptionHeight: 120,
    bottomCaptionHeight: 160,
    captionBgOpacity: 1.0,
  },
};

async function ensureDir(p: string) {
  await fs.mkdir(p, { recursive: true });
}

async function exists(p: string) {
  try { await fs.stat(p); return true; } catch { return false; }
}

describe('video-generator integration (real ffmpeg)', () => {
  beforeAll(async () => {
    await ensureDir(outDir);
    await ensureDir(testData);
    // Generate dummy media using ffmpeg so we don't rely on repo assets
    await new Promise<void>((resolve, reject) => {
      // background.mp4: 1080x1920 black, 15s
      ffmpeg()
        // color source via lavfi
        .input('color=c=black:s=1080x1920:d=15')
        .inputOptions(['-f', 'lavfi'])
        .outputOptions(['-pix_fmt', 'yuv420p'])
        .on('end', () => resolve())
        .on('error', reject)
        .save(path.join(testData, 'background.mp4'));
    });
    await new Promise<void>((resolve, reject) => {
      // bgm.wav: 15s sine wave
      ffmpeg()
        .input('sine=frequency=1000:duration=15')
        .inputOptions(['-f', 'lavfi'])
        .outputOptions(['-ac', '2', '-ar', '44100'])
        .on('end', () => resolve())
        .on('error', reject)
        .save(path.join(testData, 'bgm.wav'));
    });
    await new Promise<void>((resolve, reject) => {
      // screenshot.png: 800x800 red image (single frame)
      ffmpeg()
        .input('color=c=red:s=800x800:d=0.1')
        .inputOptions(['-f', 'lavfi'])
        .outputOptions(['-frames:v', '1'])
        .on('end', () => resolve())
        .on('error', reject)
        .save(path.join(testData, 'screenshot.png'));
    });
  }, 30_000);

  afterAll(async () => {
    // keep artifacts for inspection
  });

  it('generates a short vertical video with overlayed screenshot and captions', async () => {
    const screenshot = path.join(testData, 'screenshot.png');
    const out = await generateVideo(screenshot, baseSettings);
    expect(out).toMatch(/video-\d+\.mp4$/);
    expect(await exists(out)).toBe(true);
    const stat = await fs.stat(out);
    expect(stat.size).toBeGreaterThan(10_000); // at least some bytes

    // Verify video properties with ffprobe
    const metadata = await new Promise<ffmpeg.FfprobeData>((resolve, reject) => {
      ffmpeg.ffprobe(out, (err, data) => {
        if (err) return reject(err);
        resolve(data);
      });
    });

    // Check video stream
    const videoStream = metadata.streams.find(s => s.codec_type === 'video');
    expect(videoStream).toBeDefined();
    expect(videoStream?.width).toBe(baseSettings.render.resolution.width);
    expect(videoStream?.height).toBe(baseSettings.render.resolution.height);
    expect(Math.round(Number(videoStream?.duration || 0))).toBe(baseSettings.render.durationSec);

    // Check audio stream
    const audioStream = metadata.streams.find(s => s.codec_type === 'audio');
    expect(audioStream).toBeDefined();
    expect(Math.round(Number(audioStream?.duration || 0))).toBe(baseSettings.render.durationSec);
  }, 120_000);

  it('re-encodes a source video to vertical with captions (no screenshot overlay)', async () => {
    const sourceUrl = path.join(testData, 'background.mp4');
    const out = await generateVideo('', baseSettings, sourceUrl);
    expect(out).toMatch(/video-\d+\.mp4$/);
    expect(await exists(out)).toBe(true);
    const stat = await fs.stat(out);
    expect(stat.size).toBeGreaterThan(10_000);

    // Verify video properties with ffprobe
    const metadata = await new Promise<ffmpeg.FfprobeData>((resolve, reject) => {
      ffmpeg.ffprobe(out, (err, data) => {
        if (err) return reject(err);
        resolve(data);
      });
    });

    const videoStream = metadata.streams.find(s => s.codec_type === 'video');
    expect(videoStream).toBeDefined();
    expect(videoStream?.width).toBe(baseSettings.render.resolution.width);
    expect(videoStream?.height).toBe(baseSettings.render.resolution.height);
  // スクショではないため durationSec は適用せず、元動画の長さ（15s）を維持する
  expect(Math.round(Number(videoStream?.duration || 0))).toBe(15);

    const audioStream = metadata.streams.find(s => s.codec_type === 'audio');
    expect(audioStream).toBeDefined();
  }, 120_000);

  it('produces files compatible with Shorts/Reels/TikTok defaults (1080x1920 <= 60s)', async () => {
    const platforms = [
      { name: 'YouTubeShorts', resolution: { width: 1080, height: 1920 }, durationSec: 10 },
      { name: 'TikTok', resolution: { width: 1080, height: 1920 }, durationSec: 9 },
    ] as const;

    for (const p of platforms) {
      const settings: AppSettings = {
        ...baseSettings,
        render: { ...baseSettings.render, resolution: p.resolution, durationSec: p.durationSec, captions: { top: `${p.name}_TOP`, bottom: `${p.name}_BOTTOM` } },
      };
      const out = await generateVideo(path.join(testData, 'screenshot.png'), settings);
      expect(await exists(out)).toBe(true);
      const stat = await fs.stat(out);
      expect(stat.size).toBeGreaterThan(10_000);

      // Verify video properties with ffprobe
      const metadata = await new Promise<ffmpeg.FfprobeData>((resolve, reject) => {
        ffmpeg.ffprobe(out, (err, data) => {
          if (err) return reject(err);
          resolve(data);
        });
      });

      const videoStream = metadata.streams.find(s => s.codec_type === 'video');
      expect(videoStream).toBeDefined();
      expect(videoStream?.width).toBe(p.resolution.width);
      expect(videoStream?.height).toBe(p.resolution.height);
      expect(Math.round(Number(videoStream?.duration || 0))).toBe(p.durationSec);
    }
  }, 240_000);

  it('saves output successfully for YouTube, TikTok scenarios', async () => {
    const scenarios = [
      { platform: 'YouTube', duration: 10 },
      { platform: 'TikTok', duration: 9 },
    ] as const;
    for (const s of scenarios) {
      const settings: AppSettings = {
        ...baseSettings,
        render: { ...baseSettings.render, durationSec: s.duration },
      };
      const out = await generateVideo(path.join(testData, 'screenshot.png'), settings);
      expect(await exists(out)).toBe(true);
      const stat = await fs.stat(out);
      // sanity: file size must be > 10KB
      expect(stat.size).toBeGreaterThan(10_000);

      // Verify video properties with ffprobe
      const metadata = await new Promise<ffmpeg.FfprobeData>((resolve, reject) => {
        ffmpeg.ffprobe(out, (err, data) => {
          if (err) return reject(err);
          resolve(data);
        });
      });

      const videoStream = metadata.streams.find(st => st.codec_type === 'video');
      expect(videoStream).toBeDefined();
      expect(videoStream?.width).toBe(baseSettings.render.resolution.width);
      expect(videoStream?.height).toBe(baseSettings.render.resolution.height);
      expect(Math.round(Number(videoStream?.duration || 0))).toBe(s.duration);
    }
  }, 180_000);
});
