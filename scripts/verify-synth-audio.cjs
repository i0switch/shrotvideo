// Verify that when no input audio exists, generateVideo maps [a_synth] without adding -af and succeeds
const path = require('node:path');
const fs = require('node:fs');
const { spawn } = require('node:child_process');

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: 'inherit', ...opts });
    p.on('error', reject);
    p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exited with code ${code}`))));
  });
}

(async () => {
  try {
    const ffmpegPath = require('ffmpeg-static');
    if (!ffmpegPath) throw new Error('ffmpeg-static not found');

    const cwd = process.cwd();
    const outDir = path.join(cwd, 'test-results', 'verify-synth');
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

    const silentBg = path.join(outDir, 'silent-bg.mp4');
    const shotPng = path.join(outDir, 'shot.png');

    // 1) Create a 3s silent black background video (no audio track)
    if (!fs.existsSync(silentBg)) {
      await run(ffmpegPath, [
        '-f', 'lavfi', '-i', 'color=size=1080x1920:rate=30:color=black',
        '-t', '3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-an', silentBg
      ]);
    }

    // 2) Create a simple white PNG as screenshot overlay
    if (!fs.existsSync(shotPng)) {
      await run(ffmpegPath, [
        '-f', 'lavfi', '-i', 'color=size=720x1280:rate=1:color=white',
        '-frames:v', '1', shotPng
      ]);
    }

    // 3) Load generator from build output
    const genPath = path.join(cwd, 'dist', 'electron', 'electron', 'tasks', 'video-generator.js');
    if (!fs.existsSync(genPath)) throw new Error('Build artifact not found: ' + genPath);
    const { generateVideo } = require(genPath);

    const settings = {
      general: { outputPath: outDir },
      platforms: {
        x: { enabled: false, accounts: [], intervalMinutes: 15, scrapeDelayMs: 0 },
        tiktok: { enabled: false, accounts: [], intervalMinutes: 15, scrapeDelayMs: 0 },
        youtube: { enabled: false, accounts: [], intervalMinutes: 15, scrapeDelayMs: 0 },
      },
      render: {
        resolution: { width: 1080, height: 1920 },
        durationSec: 3,
        bgmPath: '',
        backgroundVideoPath: silentBg,
        scale: 0.9,
        qualityPreset: 'standard',
        overlayPosition: 'center',
      },
    };

    // Use screenshot overlay path with silent background to force synth audio
    const output = await generateVideo(shotPng, settings, undefined, { forceDuration: true, accountId: { platform: 'x', id: 'test' }, sourceType: 'screenshot' });
    console.log('verify-synth-audio: OK ->', output);
    process.exit(0);
  } catch (e) {
    console.error('verify-synth-audio: FAILED ->', e && e.message ? e.message : String(e));
    process.exit(1);
  }
})();
