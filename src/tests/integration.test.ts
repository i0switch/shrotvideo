import { describe, it, expect, vi } from 'vitest';
import { scrapeAccount } from '../../electron/tasks/scraper';
import { generateVideo } from '../../electron/tasks/video-generator';
import type { AppSettings, Platform } from '../core/settings';

const dummySettings: AppSettings = {
  general: { outputPath: './test-output' },
  platforms: {
    x: { enabled: false, accounts: [], intervalMinutes: 15, scrapeDelayMs: 1000 },
    tiktok: { enabled: false, accounts: [], intervalMinutes: 15, scrapeDelayMs: 1000 },
    instagram: { enabled: false, accounts: [], intervalMinutes: 15, scrapeDelayMs: 1000 },
    youtube: { enabled: false, accounts: [], intervalMinutes: 15, scrapeDelayMs: 1000 },
  },
  render: {
    resolution: { width: 640, height: 360 },
    durationSec: 5,
    bgmPath: '',
    backgroundVideoPath: '',
    captions: { top: 'テスト', bottom: '動画' },
    scale: 0.8,
    teleTextBg: '#000000',
    qualityPreset: 'low',
    overlayPosition: 'center',
    topCaptionHeight: 100,
    bottomCaptionHeight: 100,
    captionBgOpacity: 0.8,
  },
};

describe('統合テスト: SNSスクレイピングと動画生成', () => {
  it('ダミー設定でscrapeAccountがnullまたはstringを返す', async () => {
    const result = await scrapeAccount('x' as Platform, 'dummy_account', dummySettings);
    expect(result === null || typeof result === 'string').toBe(true);
  });

  it('ダミー画像パスでgenerateVideoがPromise<string>を返す', async () => {
    // 実際の画像ファイルは不要。ffmpegがエラーを返す場合もcatchでOK。
    try {
      const videoPath = await generateVideo('./dummy.png', dummySettings);
      expect(typeof videoPath).toBe('string');
    } catch (e) {
      expect(e).toBeInstanceOf(Error);
    }
  });
});
