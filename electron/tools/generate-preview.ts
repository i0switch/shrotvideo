import path from 'node:path';
import { mkdirSync } from 'node:fs';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegStatic from 'ffmpeg-static';
import { generateVideo } from '../tasks/video-generator.js';
import type { AppSettings } from '../../src/core/settings.js';

// Ensure ffmpeg binary
if (ffmpegStatic) {
  (ffmpeg as unknown as { setFfmpegPath: (p: string) => void }).setFfmpegPath(ffmpegStatic as unknown as string);
}

async function main() {
  const cwd = process.cwd();
  const bg = path.join(cwd, 'test-data', 'background.mp4');
  const outDir = path.join(cwd, 'test-results', 'auto-preview');
  mkdirSync(outDir, { recursive: true });

  const settings: AppSettings = {
    general: { outputPath: outDir },
    platforms: { x: { enabled: false, accounts: [], intervalMinutes: 15, scrapeDelayMs: 0 }, tiktok: { enabled: false, accounts: [], intervalMinutes: 15, scrapeDelayMs: 0 }, youtube: { enabled: false, accounts: [], intervalMinutes: 15, scrapeDelayMs: 0 } },
    render: {
      resolution: { width: 1080, height: 1920 },
      durationSec: 2,
      bgmPath: '',
      backgroundVideoPath: '',
      captions: { top: 'TOP', bottom: 'BOTTOM' },
      scale: 0.8,
      teleTextBg: '#000000',
      qualityPreset: 'standard',
      overlayPosition: 'center',
      topCaptionHeight: 120,
      bottomCaptionHeight: 160,
      captionBgOpacity: 1,
      fontFilePath: ''
    }
  } as AppSettings;

  const out = await generateVideo('', settings, bg);
  console.log('[preview-cli] generated:', out);
}

main().catch((e) => {
  console.error('[preview-cli] failed:', (e as Error)?.message || String(e));
  process.exit(1);
});
