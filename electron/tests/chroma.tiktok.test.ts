import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generateVideo } from '../tasks/video-generator.js';
import type { AppSettings } from '../../src/core/settings';
// Mock fs.existsSync via vi.mock to avoid ESM spy limitations
vi.mock('node:fs', async (orig) => {
  const actual: any = await (orig() as any);
  return {
    ...actual,
    existsSync: (p: any) => p === '/path/to/overlay.png' || p === '/path/to/background.mp4' || p === '/path/to/bgm.mp3'
  };
});
import * as fs from 'node:fs';
import ffmpeg from 'fluent-ffmpeg';

// Mock fluent-ffmpeg like other tests
const mockFfmpeg = {
  input: vi.fn().mockReturnThis(),
  complexFilter: vi.fn().mockReturnThis(),
  outputOptions: vi.fn().mockReturnThis(),
  duration: vi.fn().mockReturnThis(),
  videoCodec: vi.fn().mockReturnThis(),
  on: vi.fn((event: string, callback: Function) => {
    if (event === 'end') callback();
    return mockFfmpeg as any;
  }),
  save: vi.fn().mockReturnThis(),
};

vi.mock('fluent-ffmpeg', () => ({
  default: vi.fn(() => mockFfmpeg),
}));
vi.mock('electron-log', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}));

describe('TikTok chroma key pipeline', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.skip('applies chroma key with RGBA format for image overlay (Case B: bg + src)', async () => {
    const settings: AppSettings = {
      general: { outputPath: '/tmp/videos' },
      platforms: {
        x: { enabled: false, accounts: [], intervalMinutes: 15, scrapeDelayMs: 0 },
        tiktok: { enabled: true, accounts: [
          { id: 'acc1', isActive: true, chromaMode: 'image', chromaImagePath: '/path/to/overlay.png' }
        ], intervalMinutes: 15, scrapeDelayMs: 0 },
        youtube: { enabled: false, accounts: [], intervalMinutes: 15, scrapeDelayMs: 0 },
      },
      render: {
        resolution: { width: 1080, height: 1920 },
        durationSec: 10,
        bgmPath: '/path/to/bgm.mp3',
        backgroundVideoPath: '/path/to/background.mp4',
        scale: 0.8,
        qualityPreset: 'standard',
        overlayPosition: 'center',
      },
    };

    const srcUrl = 'http://example.com/tiktok.mp4';
  await generateVideo('', settings, srcUrl, { accountId: { platform: 'tiktok', id: 'acc1' }, folderChroma: { mode: 'image', image: '/path/to/overlay.png' } });

    // Validate the filter graph contains RGBA + chromakey in the chain
    const calls = (mockFfmpeg.complexFilter as any).mock.calls as string[][];
    expect(calls.length).toBeGreaterThan(0);
    const filter = calls[0][0] as string;
    expect(filter).toContain('[bg]');
    expect(filter).toContain('[fg]');
    // chroma path should include format=rgba,chromakey=0x00FD00 and overlay onto src_over_bg
    expect(filter).toMatch(/format=rgba,chromakey=0x00FD00:\d+\.\d+:/);
    expect(filter).toContain('[src_over_bg][keyed]overlay');
  });
});
