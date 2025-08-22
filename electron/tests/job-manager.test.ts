import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AppSettings } from '../../src/core/settings';
import { JobManager } from '../job-manager.js';

// Mock modules used by JobManager
vi.mock('electron-log', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

// Mock scraper: return two items for backfill
vi.mock('../tasks/scraper.js', () => ({
  scrapeAccount: vi.fn(),
  listRecentItems: vi.fn(async (_platform: string, _accountId: string, limit: number) => {
    const n = Math.min(limit, 2);
    return Array.from({ length: n }).map((_, i) => ({ id: `id-${i+1}`, type: 'screenshot', path: `C:/tmp/shot-${i+1}.png` }));
  }),
}));

// Mock video generator to resolve quickly
vi.mock('../tasks/video-generator.js', () => ({
  generateVideo: vi.fn(async () => 'C:/tmp/out.mp4'),
}));

// Minimal in-memory store mock compatible enough for JobManager
class MockStore<T> {
  public store: T;
  private kv = new Map<string, unknown>();
  constructor(defaults: T) {
    this.store = defaults;
  }
  get(k: string, d: unknown) { return (this.kv.has(k) ? this.kv.get(k) : d) as unknown; }
  set(k: string, v: unknown) { this.kv.set(k, v); }
}

describe('JobManager basic', () => {
  beforeEach(() => vi.clearAllMocks());

  it('runs backfill via listRecentItems and calls generateVideo for each', async () => {
    const settings: AppSettings = {
      general: { outputPath: 'C:/tmp/out', diagnosticLogging: false, diagnosticIntervalSec: 10 },
      platforms: {
        x: { enabled: true, accounts: [{ id: 'foo', isActive: true, backfillRemaining: 2 }], intervalMinutes: 60, scrapeDelayMs: 0 },
        tiktok: { enabled: false, accounts: [], intervalMinutes: 15, scrapeDelayMs: 0 },
        instagram: { enabled: false, accounts: [], intervalMinutes: 15, scrapeDelayMs: 0 },
        youtube: { enabled: false, accounts: [], intervalMinutes: 15, scrapeDelayMs: 0 },
      },
      render: {
        resolution: { width: 1080, height: 1920 },
        durationSec: 1,
        bgmPath: '',
        backgroundVideoPath: '',
        captions: { top: '', bottom: '' },
        scale: 0.8,
        teleTextBg: '#000000',
        qualityPreset: 'standard',
        overlayPosition: 'center',
        topCaptionHeight: 120,
        bottomCaptionHeight: 160,
        captionBgOpacity: 1,
      },
    };

    const store = new MockStore<AppSettings>(settings) as unknown as any; // satisfy typing
    const jm = new JobManager(store);
    jm.start();

    // Allow queue to drain
    await new Promise(r => setTimeout(r, 200));

    const gen = await import('../tasks/video-generator.js');
    expect((gen as any).generateVideo).toHaveBeenCalledTimes(2);

    const status = jm.getStatus();
    expect(status.isRunning).toBe(true);
  // runMonitoringTask 単位でカウントされるため、少なくとも1回以上増えていることを確認
  expect(status.platforms['x']?.processedCount).toBeGreaterThanOrEqual(1);
    jm.stop();
  });
});
