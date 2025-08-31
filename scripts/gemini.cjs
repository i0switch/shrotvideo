'use strict';

// GEMINI orchestrator CLI
// Modes:
//  - spec: generate .artifacts/spec/* (app_spec.json, repo_graph.json, _meta.json)
//  - generate: produce 3 items per platform (YouTube/TikTok/X) into test-results/auto-gen
//  - all: spec + generate

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');

function logInfo(...args) { console.log('[gemini]', ...args); }
function logWarn(...args) { console.warn('[gemini]', ...args); }
function logErr(...args) { console.error('[gemini]', ...args); }

function ensureDirSync(p) { fs.mkdirSync(p, { recursive: true }); }
async function ensureDir(p) { await fsp.mkdir(p, { recursive: true }); }

function readJsonSafe(p, def = null) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return def; }
}

function nowIso() { return new Date().toISOString(); }

async function runExecFile(file, args, options = {}) {
  return await new Promise((resolve, reject) => {
    const p = execFile(file, args, { timeout: options.timeout ?? 120000, windowsHide: true }, (err, stdout, stderr) => {
      if (err) return reject(Object.assign(new Error(err.message || String(err)), { stdout, stderr }));
      resolve({ stdout: stdout?.toString() ?? '', stderr: stderr?.toString() ?? '' });
    });
    // Prevent hanging child processes on Windows PowerShell when parent exits
    p.on('error', (e) => reject(e));
  });
}

function repoRoot() {
  return process.cwd();
}

function findBinaryYtDlp() {
  const bin = path.join(repoRoot(), 'node_modules', 'ytdlp-nodejs', 'bin', process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');
  return fs.existsSync(bin) ? bin : 'yt-dlp';
}

function ffmpegPath() {
  try {
    // lazy require to avoid dependency if not installed
    const ffmpegStatic = require('ffmpeg-static');
    if (ffmpegStatic) return String(ffmpegStatic);
  } catch {}
  return 'ffmpeg';
}

async function writeSpecArtifacts() {
  const root = repoRoot();
  const artifactsDir = path.join(root, '.artifacts');
  const specDir = path.join(artifactsDir, 'spec');
  ensureDirSync(specDir);

  const pkg = readJsonSafe(path.join(root, 'package.json'), {});
  const name = pkg.name || 'unknown';
  const version = pkg.version || '0.0.0';

  const appSpec = {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    title: 'AppSpec',
    type: 'object',
    name,
    version,
    platforms: {
      youtube: { status: 'ok', selectors: {}, login: {}, outputMode: 'background_composite' },
      tiktok: { status: 'ok', selectors: {}, login: {}, outputMode: 'background_composite' },
      x: { status: 'needs_fix', selectors: {}, login: {}, outputMode: 'screenshot_overlay' },
    },
    pipelines: [
      { name: 'youtube_pipeline', steps: ['listRecent', 'download', 'generate'], entry: 'npm run gemini:generate -- --platform youtube' },
      { name: 'tiktok_pipeline', steps: ['listRecent', 'download', 'generate'], entry: 'npm run gemini:generate -- --platform tiktok' },
      { name: 'x_pipeline', steps: ['listRecent', 'screenshot', 'generate'], entry: 'npm run gemini:generate -- --platform x' },
    ],
    settings: {
      outputDir: 'test-results/auto-gen',
      screenshotDir: 'test-results/auto-gen/x-shots',
      headless: true,
      timeoutMs: 60000,
      ffmpeg: { bin: ffmpegPath(), templatesDir: '' },
    },
  };

  const repoGraph = {
    nodes: [
      'electron/tasks/video-generator.ts',
      'electron/tasks/downloader.ts',
      'electron/tasks/scraper.ts',
      'electron/tools/generate-from-urls.ts',
      'src/core/settings.ts',
    ],
    edges: [
      ['electron/tools/generate-from-urls.ts', 'electron/tasks/video-generator.ts'],
      ['electron/tasks/downloader.ts', 'electron/tasks/scraper.ts'],
      ['electron/tasks/video-generator.ts', 'src/core/settings.ts'],
    ],
  };

  // meta
  let commit = '';
  let branch = '';
  try {
    const { stdout: c } = await runExecFile('git', ['rev-parse', 'HEAD']);
    commit = c.trim();
  } catch {}
  try {
    const { stdout: b } = await runExecFile('git', ['rev-parse', '--abbrev-ref', 'HEAD']);
    branch = b.trim();
  } catch {}
  const meta = { generatedAt: nowIso(), branch: branch || 'unknown', commit: commit || 'unknown' };

  await fsp.writeFile(path.join(specDir, 'app_spec.json'), JSON.stringify(appSpec, null, 2));
  await fsp.writeFile(path.join(specDir, 'repo_graph.json'), JSON.stringify(repoGraph, null, 2));
  await fsp.writeFile(path.join(specDir, '_meta.json'), JSON.stringify(meta, null, 2));
  logInfo('Wrote spec artifacts to', specDir);
}

async function generateDummyAssets(outBase) {
  const testData = path.join(outBase, 'data');
  ensureDirSync(testData);
  // Use fluent-ffmpeg to generate small assets
  let ffmpeg;
  try { ffmpeg = require('fluent-ffmpeg'); } catch { throw new Error('fluent-ffmpeg is required'); }
  try { const ff = ffmpeg; const fp = ffmpegPath(); if (fp && ff.setFfmpegPath) ff.setFfmpegPath(fp); } catch {}
  // background.mp4 (10s black)
  await new Promise((resolve, reject) => {
    require('fluent-ffmpeg')()
      .input('color=c=black:s=1080x1920:d=10')
      .inputOptions(['-f', 'lavfi'])
      .outputOptions(['-pix_fmt', 'yuv420p'])
      .on('end', resolve)
      .on('error', reject)
      .save(path.join(testData, 'background.mp4'));
  });
  // bgm.wav (10s sine)
  await new Promise((resolve, reject) => {
    require('fluent-ffmpeg')()
      .input('sine=frequency=800:duration=10')
      .inputOptions(['-f', 'lavfi'])
      .outputOptions(['-ac', '2', '-ar', '44100'])
      .on('end', resolve)
      .on('error', reject)
      .save(path.join(testData, 'bgm.wav'));
  });
  // placeholder screenshot
  await new Promise((resolve, reject) => {
    require('fluent-ffmpeg')()
      .input('color=c=red:s=800x800:d=0.1')
      .inputOptions(['-f', 'lavfi'])
      .outputOptions(['-frames:v', '1'])
      .on('end', resolve)
      .on('error', reject)
      .save(path.join(testData, 'screenshot.png'));
  });
  return { testData };
}

function buildSettings(outputPath, assetsDir) {
  return {
    general: { outputPath },
    platforms: {
      x: { enabled: true, accounts: [], intervalMinutes: 15, scrapeDelayMs: 0 },
      tiktok: { enabled: true, accounts: [], intervalMinutes: 15, scrapeDelayMs: 0 },
      youtube: { enabled: true, accounts: [], intervalMinutes: 15, scrapeDelayMs: 0 },
    },
    render: {
      resolution: { width: 1080, height: 1920 },
      durationSec: 10,
      bgmPath: path.join(assetsDir, 'bgm.wav'),
      backgroundVideoPath: path.join(assetsDir, 'background.mp4'),
      captions: { top: 'AUTO_TOP', bottom: 'AUTO_BOTTOM' },
      scale: 0.8,
      teleTextBg: '#000000',
      qualityPreset: 'standard',
      overlayPosition: 'center',
      topCaptionHeight: 120,
      bottomCaptionHeight: 160,
      captionBgOpacity: 1,
    },
  };
}

async function importGenerateVideo() {
  // Prefer built JS; fallback to ts-node
  const distPath = path.join(repoRoot(), 'dist', 'electron', 'electron', 'tasks', 'video-generator.js');
  if (fs.existsSync(distPath)) {
    return require(distPath).generateVideo;
  }
  try {
    require('ts-node/register');
    return require(path.join(repoRoot(), 'electron', 'tasks', 'video-generator.ts')).generateVideo;
  } catch (e) {
    throw new Error('Failed to load generateVideo. Please run: npm run build:electron');
  }
}

async function listYouTubeShortsUrls(channelId, limit = 3) {
  const ytUrl = `https://www.youtube.com/@${channelId}/shorts`;
  const bin = findBinaryYtDlp();
  const args = [
    ytUrl,
    '-J',
    '--flat-playlist',
    '--ignore-errors',
    '--no-warnings',
    '--impersonate', 'chrome',
    '--extractor-args', 'youtube:tab=shorts',
    '--playlist-end', String(Math.max(3, limit * 2)),
  ];
  const { stdout } = await runExecFile(bin, args, { timeout: 90000 });
  let data; try { data = JSON.parse(stdout); } catch { return []; }
  const flat = [];
  const push = (en) => { if (en) flat.push(en); };
  if (Array.isArray(data?.entries)) {
    for (const en of data.entries) {
      if (en && Array.isArray(en.entries)) { for (const e of en.entries) push(e); }
      else push(en);
    }
  } else push(data);
  const urls = [];
  for (const e of flat) {
    let u = e.webpage_url || e.url || '';
    const id = e.id;
    if (!u && id && typeof id === 'string' && id.length >= 10) u = `https://www.youtube.com/shorts/${id}`;
    if (typeof u === 'string' && /\/shorts\//.test(u)) {
      urls.push(u);
      if (urls.length >= limit) break;
    }
  }
  return urls;
}

async function listTikTokUrls(userId, limit = 3) {
  const url = `https://www.tiktok.com/@${userId}`;
  const bin = findBinaryYtDlp();
  const args = [url, '--dump-json', '--flat-playlist', '--playlist-end', String(limit), '--no-warnings'];
  const { stdout } = await runExecFile(bin, args, { timeout: 90000 });
  const lines = stdout.trim().split(/\r?\n/);
  const out = [];
  for (const line of lines) {
    try { const j = JSON.parse(line); const u = j.webpage_url || j.url; if (u) out.push(String(u)); } catch {}
    if (out.length >= limit) break;
  }
  return out;
}

async function downloadVideo(pageUrl, destDir) {
  await ensureDir(destDir);
  const safe = pageUrl.replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, 64);
  const outPath = path.join(destDir, `${safe}.mp4`);
  const bin = findBinaryYtDlp();
  const args = [
    pageUrl,
    '-o', outPath,
    '-f', 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best',
    '--merge-output-format', 'mp4',
    '--no-playlist',
    '--no-warnings',
  ];
  await runExecFile(bin, args, { timeout: 180000 });
  return outPath;
}

async function screenshotXPosts(account, destDir, count = 3) {
  await ensureDir(destDir);
  const { chromium } = require('playwright');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1200, height: 2000 } });
  const page = await context.newPage();
  const out = [];
  try {
    await page.goto(`https://x.com/${account}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
    const arts = page.locator('article[role="article"]');
    const n = await arts.count();
    const take = Math.min(count, Math.max(0, n));
    for (let i = 0; i < take; i++) {
      const a = arts.nth(i);
      try {
        await a.waitFor({ state: 'visible', timeout: 15000 });
        const file = path.join(destDir, `xshot-${Date.now()}-${i}.png`);
        await a.screenshot({ path: file });
        out.push(file);
      } catch (e) {
        // fallback fullPage
        try {
          const file = path.join(destDir, `xshot-full-${Date.now()}-${i}.png`);
          await page.screenshot({ path: file, fullPage: true });
          out.push(file);
        } catch {}
      }
    }
  } finally {
    await context.close();
    await browser.close();
  }
  return out;
}

async function generateAll(platformFilter) {
  const root = repoRoot();
  const outBase = path.join(root, 'test-results', 'auto-gen');
  const logDir = path.join(root, '.artifacts', 'logs', String(Date.now()));
  ensureDirSync(outBase); ensureDirSync(logDir);
  const { testData } = await generateDummyAssets(outBase);
  const outputDir = outBase;
  const settings = buildSettings(outputDir, testData);
  const generateVideo = await importGenerateVideo();

  const results = [];
  const failures = [];
  const tasks = [];

  const wanted = (name) => !platformFilter || platformFilter === name;

  if (wanted('youtube')) {
    const outDir = path.join(outBase, 'youtube'); ensureDirSync(outDir);
    const urls = await listYouTubeShortsUrls(process.env.GEM_YT_ACCOUNT || 'CreativeCommons', 3);
    for (const [idx, u] of urls.entries()) {
      tasks.push({ platform: 'youtube', idx, run: async () => {
        try {
          const file = await downloadVideo(u, path.join(os.tmpdir(), 'svt_dl'));
          const s = { ...settings, render: { ...settings.render, captions: { top: 'YouTube', bottom: u.split('/').pop()?.slice(0, 20) || '' } } };
          const out = await generateVideo('', s, file, { forceDuration: true });
          results.push(out);
        } catch (e) { failures.push({ platform: 'youtube', url: u, error: String(e?.message || e) }); }
      } });
    }
  }

  if (wanted('tiktok')) {
    const outDir = path.join(outBase, 'tiktok'); ensureDirSync(outDir);
    const urls = await listTikTokUrls(process.env.GEM_TT_ACCOUNT || 'scout2015', 3);
    for (const [idx, u] of urls.entries()) {
      tasks.push({ platform: 'tiktok', idx, run: async () => {
        try {
          const file = await downloadVideo(u, path.join(os.tmpdir(), 'svt_dl'));
          const s = { ...settings, render: { ...settings.render, captions: { top: 'TikTok', bottom: u.split('/').pop()?.slice(0, 20) || '' } } };
          const out = await generateVideo('', s, file, { forceDuration: true });
          results.push(out);
        } catch (e) { failures.push({ platform: 'tiktok', url: u, error: String(e?.message || e) }); }
      } });
    }
  }

  if (wanted('x')) {
    const outDir = path.join(outBase, 'x'); ensureDirSync(outDir);
    const shots = await screenshotXPosts(process.env.GEM_X_ACCOUNT || 'elonmusk', outDir, 3);
    for (const [idx, pth] of shots.entries()) {
      tasks.push({ platform: 'x', idx, run: async () => {
        try {
          const s = { ...settings, render: { ...settings.render, captions: { top: 'X', bottom: path.basename(pth) } } };
          const out = await generateVideo(pth, s, '', { forceDuration: true });
          results.push(out);
        } catch (e) { failures.push({ platform: 'x', path: pth, error: String(e?.message || e) }); }
      } });
    }
  }

  // Run sequentially to reduce resource contention
  for (const t of tasks) {
    logInfo(`Running ${t.platform} #${t.idx + 1}/${tasks.length}`);
    // basic retry once
    try { await t.run(); } catch { try { await t.run(); } catch (e) { logWarn('Retry failed:', e?.message || e); } }
  }

  const summary = { when: nowIso(), results, failures };
  await fsp.writeFile(path.join(logDir, 'generate-summary.json'), JSON.stringify(summary, null, 2));
  logInfo('Generation complete. Outputs:', results.length, 'Failures:', failures.length);
}

async function main() {
  const mode = process.argv[2] || 'all';
  const platformArgIdx = process.argv.findIndex(a => a === '--platform');
  const platform = platformArgIdx >= 0 ? (process.argv[platformArgIdx + 1] || '').toLowerCase() : '';

  if (mode === 'spec') {
    await writeSpecArtifacts();
    return;
  }
  if (mode === 'generate') {
    await generateAll(platform);
    return;
  }
  if (mode === 'all') {
    await writeSpecArtifacts();
    await generateAll(platform);
    return;
  }
  console.log('Usage: node scripts/gemini.cjs [spec|generate|all] [--platform youtube|tiktok|x]');
}

main().catch((e) => { logErr(e?.message || String(e)); process.exit(1); });
