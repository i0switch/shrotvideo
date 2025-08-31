// Minimal generator without Playwright: overlays a video as if it were a screenshot
const path = require('node:path');
const fs = require('node:fs');

(async () => {
  try {
    const genPath = path.join(process.cwd(), 'dist', 'electron', 'electron', 'tasks', 'video-generator.js');
    const { generateVideo } = require(genPath);

    const outDir = path.join(process.cwd(), 'output', 'x');
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

    const bg = path.join(process.cwd(), 'test-data', 'background.mp4');
    if (!fs.existsSync(bg)) throw new Error('Missing test-data/background.mp4');

    const settings = {
      general: { outputPath: outDir },
      platforms: {
        x: { enabled: false, accounts: [], intervalMinutes: 15, scrapeDelayMs: 0 },
        tiktok: { enabled: false, accounts: [], intervalMinutes: 15, scrapeDelayMs: 0 },
        youtube: { enabled: false, accounts: [], intervalMinutes: 15, scrapeDelayMs: 0 }
      },
      render: {
        resolution: { width: 1080, height: 1920 },
        durationSec: 8,
        backgroundVideoPath: bg,
        captions: { top: 'X', bottom: 'scale=0.9 demo' },
        scale: 0.9,
        teleTextBg: '#000000',
        captionBgOpacity: 1,
        overlayPosition: 'center',
        qualityPreset: 'standard'
      }
    };

    // Use the same video as a faux screenshot input; pipeline treats it as overlay (contain with scale)
    const output = await generateVideo(bg, settings, undefined, { forceDuration: true });
    console.log('Output:', output);
  } catch (e) {
    console.error('Generation failed:', e && e.message ? e.message : String(e));
    process.exit(1);
  }
})();
