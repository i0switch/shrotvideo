// One-off preview generator using compiled Electron task (CommonJS)
const path = require('node:path');
const fs = require('node:fs');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegStatic = require('ffmpeg-static');

(async () => {
  const cwd = process.cwd();
  const testDataDir = path.join(cwd, 'test-data');
  const bg = path.join(testDataDir, 'background.mp4');
  const outDir = path.join(cwd, 'test-results', 'auto-preview');
  fs.mkdirSync(outDir, { recursive: true });
  fs.mkdirSync(testDataDir, { recursive: true });

  // Prepare background video if missing (2s solid color)
  if (!fs.existsSync(bg)) {
    if (ffmpegStatic) {
      ffmpeg.setFfmpegPath(ffmpegStatic);
    }
    await new Promise((resolve, reject) => {
      ffmpeg()
        .input('color=c=black:s=1080x1920:d=2')
        .inputOptions(['-f', 'lavfi'])
        .videoCodec('libx264')
        .outputOptions(['-pix_fmt', 'yuv420p'])
        .on('error', (err) => reject(err))
        .on('end', () => resolve())
        .save(bg);
    });
  }

  // Use require to load compiled CommonJS output to avoid Windows ESM file URL issues
  const modPath = path.join(cwd, 'dist', 'electron', 'electron', 'tasks', 'video-generator.js');
  const mod = require(modPath);
  const generateVideo = mod.generateVideo || (mod.default && mod.default.generateVideo);

  if (typeof generateVideo !== 'function') {
    console.error('[run-preview] could not load generateVideo from', modPath);
    process.exit(1);
  }

  const settings = {
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
  };

  try {
    const out = await generateVideo('', settings, bg);
    console.log('[run-preview] generated:', out);
  } catch (e) {
    console.error('[run-preview] failed:', e && e.message ? e.message : String(e));
    process.exit(1);
  }
})();
