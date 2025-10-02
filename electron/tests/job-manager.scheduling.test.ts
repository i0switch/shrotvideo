import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { AppSettings } from '../../src/core/settings';

// Mocks for external modules used by JobManager
type ListRecentItems = (
  platform: 'x'|'tiktok'|'youtube',
  accountId: string,
  limit: number,
  sinceCursor?: string
) => Promise<Array<{ id: string; type: 'screenshot'|'video_url'; url?: string; path?: string }>>;
const listRecentItemsMock = vi.fn<ListRecentItems>();

vi.mock('../tasks/scraper', () => ({
  listRecentItems: (...args: Parameters<ListRecentItems>) => listRecentItemsMock(...args),
}));

const downloadVideoToTempMock = vi.fn(async () => ({ filepath: '/tmp/src.mp4' }));
vi.mock('../tasks/downloader', () => ({
  downloadVideoToTemp: () => downloadVideoToTempMock(),
}));

const generateVideoMock = vi.fn(async () => '/tmp/out.mp4');
vi.mock('../tasks/video-generator', () => ({
  generateVideo: () => generateVideoMock(),
}));

// Minimal mock of electron-store compatible enough for JobManager usage
class MockStore<T extends object> {
  public store: any;
  constructor(init: T) { this.store = JSON.parse(JSON.stringify(init)); }
  get(key: string, def?: any) {
    if (key === 'jobState') return this.store.jobState ?? def;
    // naive get: support top-level only for tests
    return this.store[key] ?? def;
  }
  set(key: string, val: any) {
    // support dot-path sets used by JobManager: e.g., platforms.youtube.accounts
    const parts = key.split('.');
    let obj = this.store;
    for (let i = 0; i < parts.length - 1; i++) {
      const p = parts[i];
      if (!obj[p] || typeof obj[p] !== 'object') obj[p] = {};
      obj = obj[p];
    }
    obj[parts[parts.length - 1]] = val;
  }
}

describe('JobManager scheduling and auto-processing', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('runs tasks on start and at specified intervals, processing unprocessed content exactly once', async () => {
    // Arrange settings with one YouTube account enabled and very short interval
    const settings: AppSettings = {
      general: { outputPath: '/tmp/out', testOutputPath: '/tmp/out', diagnosticLogging: false, diagnosticIntervalSec: 10, initialBackfillCount: 0 },
      platforms: {
        x: { enabled: false, accounts: [], intervalMinutes: 15, scrapeDelayMs: 0 },
        tiktok: { enabled: false, accounts: [], intervalMinutes: 15, scrapeDelayMs: 0 },
        youtube: {
          enabled: true,
          accounts: [ { id: 'channel1', isActive: true, processedIds: [], backfillRemaining: 0, lastCursor: '' } ],
          intervalMinutes: 0.001, // ~60ms
          scrapeDelayMs: 0,
        },
      },
      render: {
        resolution: { width: 1080, height: 1920 },
        durationSec: 2,
        bgmPath: '',
        backgroundVideoPath: '',
        scale: 0.8,
        qualityPreset: 'standard',
        overlayPosition: 'center',
      },
    };

    // First call returns one new item (unprocessed); subsequent calls return the same item id to ensure dedupe works
    const item = { id: 'YTSHORT-AAA', type: 'video_url' as const, url: 'https://youtu.be/AAA' };
    listRecentItemsMock.mockImplementation(async (_p, _id, _limit, _since) => {
      return [item];
    });

    const { JobManager } = await import('../job-manager');
    const store = new MockStore<AppSettings & { jobState?: any }>(settings) as any; // type: electron-store compatible
    const jm = new JobManager(store);

    // Act: start and flush initial run
    jm.start();
    // Allow initial immediate run to enqueue and process
    await vi.advanceTimersByTimeAsync(10);
    // Give promises time to resolve
    await Promise.resolve();

    // Assert: first processing happened
    expect(generateVideoMock).toHaveBeenCalledTimes(1);

    // Simulate another interval tick; since the same id would be returned, dedupe should prevent reprocessing
    await vi.advanceTimersByTimeAsync(100);
    await Promise.resolve();

    expect(generateVideoMock).toHaveBeenCalledTimes(1);

    // Ensure that the lastCursor and processedIds were updated in store
    const accounts = store.store.platforms.youtube.accounts;
    expect(accounts[0].lastCursor).toBe(item.id);
    expect(accounts[0].processedIds?.includes(item.id)).toBe(true);

    // Cleanup
    jm.stop();
  });

  it('backfills N items once when backfillRemaining > 0 and then resets to 0', async () => {
    const settings: AppSettings = {
      general: { outputPath: '/tmp/out', diagnosticLogging: false, diagnosticIntervalSec: 10, initialBackfillCount: 0 },
      platforms: {
        x: { enabled: false, accounts: [], intervalMinutes: 15, scrapeDelayMs: 0 },
        tiktok: { enabled: false, accounts: [], intervalMinutes: 15, scrapeDelayMs: 0 },
        youtube: {
          enabled: true,
          accounts: [ { id: 'channel1', isActive: true, processedIds: [], backfillRemaining: 2, lastCursor: '' } ],
          intervalMinutes: 0.001,
          scrapeDelayMs: 0,
        },
      },
      render: {
        resolution: { width: 1080, height: 1920 },
        durationSec: 2,
        bgmPath: '',
        backgroundVideoPath: '',
        scale: 0.8,
        qualityPreset: 'standard',
        overlayPosition: 'center',
      },
    } as any;

    const items = [
      { id: 'ID1', type: 'video_url' as const, url: 'https://youtu.be/ID1' },
      { id: 'ID2', type: 'video_url' as const, url: 'https://youtu.be/ID2' },
      { id: 'ID3', type: 'video_url' as const, url: 'https://youtu.be/ID3' },
    ];
    listRecentItemsMock.mockImplementation(async (_p, _id, limit, _since) => {
      return items.slice(0, limit);
    });

    const { JobManager } = await import('../job-manager');
    const store = new MockStore<AppSettings & { jobState?: any }>(settings) as any;
    const jm = new JobManager(store);

    jm.start();
    await vi.advanceTimersByTimeAsync(10);
    await Promise.resolve();

    // Exactly 2 items should be processed due to backfillRemaining = 2
    expect(generateVideoMock).toHaveBeenCalledTimes(2);
    const acct = store.store.platforms.youtube.accounts[0];
    expect(acct.backfillRemaining).toBe(0);
    expect(acct.processedIds?.length).toBeGreaterThanOrEqual(2);

    jm.stop();
  });
});
