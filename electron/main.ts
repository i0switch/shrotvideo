// @ts-nocheck
import {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  globalShortcut,
} from 'electron';
import { exec } from 'child_process';
import './login';
import './dialogs';
import path from 'path';
import fs from 'node:fs/promises';
import { existsSync as existsSyncFS, mkdirSync } from 'node:fs';
// import { fileURLToPath } from 'url';
import Store from 'electron-store';
import type { AppSettings } from '../src/core/settings.js';
import { JobManager } from './job-manager.js';
import log from 'electron-log';
import type { LogMessage } from 'electron-log';
import * as keytar from 'keytar'; // Add this line
import { generateVideo } from './tasks/video-generator.js';
import { scrapeX, listRecentItems } from './tasks/scraper.js'; // Add this line
import { spawn } from 'node:child_process';

// Configure logger
log.initialize();
log.transports.file.level = 'debug';
// Offscreen capture stability on some Windows setups
try { app.disableHardwareAcceleration(); } catch { /* ignore */ }
// Duplicate logs to JSONL file and forward to renderer
let jsonlPath: string | null = null;
const ensureJsonlPath = async () => {
  try {
    if (!jsonlPath) {
      const dir = path.join(app.getPath('userData'), 'logs');
      await fs.mkdir(dir, { recursive: true });
      jsonlPath = path.join(dir, 'app.log.jsonl');
    }
  } catch {
    // noop
  }
};

let mainWindow: BrowserWindow | null = null;
let diagTimer: NodeJS.Timeout | null = null;
let lastDiagEnabled = false;
let lastDiagIntervalMs = 0;

// Ensure Playwright Chromium browser is installed (idempotent). Install into userData\ms-playwright.
async function ensurePlaywrightInstalled(): Promise<void> {
  // Helper: resolve a usable playwright CLI.js path
  const resolvePlaywrightCli = (): string | null => {
    try {
      // Preferred: playwright as a dependency
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const pwPkg = require.resolve('playwright/package.json');
      return path.join(path.dirname(pwPkg), 'cli.js');
    } catch {
      // Fallback: playwright bundled under @playwright/test's node_modules
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const testPkg = require.resolve('@playwright/test/package.json');
        const candidate = path.join(path.dirname(testPkg), 'node_modules', 'playwright', 'cli.js');
        if (existsSyncFS(candidate)) return candidate;
      } catch {/* noop */}
    }
    return null;
  };

  try {
    const cliJs = resolvePlaywrightCli();
    if (!cliJs) {
      log.warn('[playwright-install] playwright CLI not found (playwright not installed). Skipping browser install.');
      return;
    }
    const browsersPath = path.join(app.getPath('userData'), 'ms-playwright');
    try { await fs.mkdir(browsersPath, { recursive: true }); } catch {}
    // Run: electron as node to execute Playwright CLI
    const exe = process.execPath; // electron.exe / packaged exe
    const env = { ...process.env, ELECTRON_RUN_AS_NODE: '1', PLAYWRIGHT_BROWSERS_PATH: browsersPath } as NodeJS.ProcessEnv;
    await new Promise<void>((resolve) => {
      try {
        const child = spawn(exe, [cliJs, 'install', 'chromium'], { env, stdio: ['ignore', 'ignore', 'pipe'] });
        let warned = false;
        child.stderr.on('data', (d) => { if (!warned) { warned = true; log.info('[playwright-install]', String(d).trim()); } });
        child.on('close', () => resolve());
        child.on('error', () => resolve());
      } catch {
        resolve();
      }
    });
  } catch (e) {
    // If CLI cannot be resolved (e.g., missing dependency), just continue; later capture code will fail and log
    log.warn('[playwright-install] skipped due to error:', (e as Error)?.message || String(e));
  }
}

// Fixed absolute screenshot root (requested): all X screenshot I/O will use only this directory
// Note: Use a proper Windows absolute path with a drive letter and escaped backslashes.
const SCREENSHOT_ROOT = 'C:\\Users\\i0swi\\OneDrive\\デスクトップ\\dougadownload\\screenshot';

// Strict helpers for electron-store access
function getAllSettings(): AppSettings {
  return (store as unknown as { store: AppSettings }).store;
}
function setSettingsPatch(patch: Partial<AppSettings>) {
  const s = store as unknown as { set: (key: string, val: unknown) => void };
  for (const [k, v] of Object.entries(patch)) s.set(k, v);
}

const store = new Store<AppSettings>({
  defaults: {
    general: {
      outputPath: app.getPath('videos'),
      testOutputPath: app.getPath('videos'),
      diagnosticLogging: false,
      diagnosticIntervalSec: 10,
      initialBackfillCount: 3,
    },
    platforms: {
      x: {
        enabled: false,
        accounts: [],
        intervalMinutes: 15,
        scrapeDelayMs: 5000, // New: Default scrape delay of 5 seconds
      },
      tiktok: {
        enabled: false,
        accounts: [],
        intervalMinutes: 15,
        scrapeDelayMs: 5000, // New: Default scrape delay of 5 seconds
      },
      youtube: {
        enabled: false,
        accounts: [],
        intervalMinutes: 15,
        scrapeDelayMs: 5000, // New: Default scrape delay of 5 seconds
      },
    },
    render: {
      resolution: {
        width: 1080,
        height: 1920,
      },
      durationSec: 15,
      bgmPath: '',
      backgroundVideoPath: '',
      fontFilePath: '',
      captions: {
        top: '',
        bottom: '',
      },
      scale: 0.8,
      teleTextBg: '#000000',
      qualityPreset: 'standard',
      overlayPosition: 'center',
      topCaptionHeight: 120, // Default from GEMINI.md example
      bottomCaptionHeight: 160, // Default from GEMINI.md example
      captionBgOpacity: 1.0, // Default from GEMINI.md example (black@1.0)
      topCaptionPosition: 'center',
      bottomCaptionPosition: 'center',
    },
  },
});

// Migration: remove unsupported platforms (e.g., legacy 'instagram') from persisted store
try {
  const supported = new Set(['x', 'tiktok', 'youtube']);
  // Sanitize platforms in settings
  const settingsAny = (store as unknown as { store: any }).store;
  if (settingsAny?.platforms) {
    const beforeKeys = Object.keys(settingsAny.platforms);
    const nextPlatforms: Record<string, unknown> = {};
    for (const k of beforeKeys) {
      if (supported.has(k)) nextPlatforms[k] = settingsAny.platforms[k];
    }
    if (beforeKeys.length !== Object.keys(nextPlatforms).length) {
      (store as unknown as { set: (key: string, val: unknown) => void }).set('platforms', nextPlatforms);
      log.info('[migrate] Removed unsupported platforms from settings.platforms:', beforeKeys.filter(k => !supported.has(k)).join(','));
    }
  }
  // Sanitize jobState platforms
  const get = (store as unknown as { get: (key: string, def?: unknown) => any }).get;
  const jobState = get('jobState', { isRunning: false, platforms: {} as Record<string, unknown> });
  if (jobState && jobState.platforms) {
    const beforeKeys = Object.keys(jobState.platforms);
    let changed = false;
    for (const k of beforeKeys) {
      if (!supported.has(k)) {
        delete jobState.platforms[k];
        changed = true;
      }
    }
    if (changed) {
      (store as unknown as { set: (key: string, val: unknown) => void }).set('jobState', jobState);
      log.info('[migrate] Removed unsupported platforms from jobState.platforms');
    }
  }
} catch (e) {
  log.warn('[migrate] settings cleanup skipped:', (e as Error)?.message || String(e));
}

const jobManager = new JobManager(store);

// Forward logs to renderer and write JSONL in parallel
Object.assign(console, log.functions);
const hookFn = (message: LogMessage): LogMessage => {
  // Forward to renderer UI
  try {
    if (mainWindow && mainWindow.webContents) {
      const text = Array.isArray(message.data) ? (message.data as unknown[]).map(String).join(' ') : '';
      const ts = message.date instanceof Date ? message.date.toISOString() : '';
      const lv = (message as unknown as { level?: string }).level ?? 'info';
      mainWindow.webContents.send('log-message', `${ts} [${lv}] ${text}`);
    }
  } catch {
    // ignore
  }
  // Write JSONL side-channel
  try {
    const write = async () => {
      await ensureJsonlPath();
      if (!jsonlPath) return;
      const rec = {
        ts: (message.date instanceof Date ? message.date.toISOString() : new Date().toISOString()),
        level: (message as unknown as { level?: string })?.level || 'info',
        text: Array.isArray(message.data) ? (message.data as unknown[]).map(String).join(' ') : '',
        scope: 'main',
      };
      await fs.appendFile(jsonlPath, JSON.stringify(rec) + '\n', { encoding: 'utf8' });
    };
    // fire-and-forget
    void write();
  } catch {
    // ignore
  }
  return message; // return original message for hooks chain
};
log.hooks.push(hookFn);



async function runShellCommand(command: string): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    exec(command, (error, stdout, stderr) => {
      if (error) {
        reject(error);
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

function setupIpcHandlers() {
  ipcMain.handle('get-settings', () => {
    // 認証IPCハンドラを有効化
    // login.ts 側で ipcMain.handle('auth.login', ...) を登録済み
    // dialogs.ts 側で ipcMain.handle('files.pickFolder', ...) などを登録済み
    return getAllSettings();
  });

  // Accept best-effort log messages from renderer (fire-and-forget)
  ipcMain.on('log-message', (_e, payload: unknown) => {
    try {
      log.info(String(payload));
    } catch {
      // swallow
    }
  });

  // Logs: return log file path
  ipcMain.handle('logs.file', async () => {
    try {
      // electron-log stores file on transports.file.getFile().path
      // We can't import the type here easily, so rely on runtime access
      const filePath = (log.transports.file.getFile && log.transports.file.getFile().path) || '';
      return filePath;
    } catch {
      return '';
    }
  });

  // Logs: read last N bytes (default ~50KB)
  ipcMain.handle('logs.read', async (_e, maxBytes: number = 51200) => {
    try {
      const filePath = (log.transports.file.getFile && log.transports.file.getFile().path) || '';
      if (!filePath) return '';
      const buf = await fs.readFile(filePath);
      if (buf.length <= maxBytes) return buf.toString('utf8');
      return buf.subarray(buf.length - maxBytes).toString('utf8');
    } catch (err) {
      const e = err as Error;
      return `LOG_READ_ERROR: ${e.message || String(err)}`;
    }
  });

  ipcMain.handle('logs.jsonlFile', async () => {
    try {
      await ensureJsonlPath();
      return jsonlPath || '';
    } catch {
      return '';
    }
  });

  ipcMain.handle('logs.readJsonl', async (_e, maxBytes: number = 51200) => {
    try {
      await ensureJsonlPath();
      if (!jsonlPath) return '';
      const buf = await fs.readFile(jsonlPath);
      if (buf.length <= maxBytes) return buf.toString('utf8');
      return buf.subarray(buf.length - maxBytes).toString('utf8');
    } catch (err) {
      const e = err as Error;
      return `JSONL_READ_ERROR: ${e.message || String(err)}`;
    }
  });

  ipcMain.handle('set-settings', (_event, settings: Partial<AppSettings>) => {
    setSettingsPatch(settings);
    // 診断ログの再スケジュール
    try { scheduleDiagnostics(); } catch { /* swallow */ }
  });

  ipcMain.handle('open-directory-dialog', async () => {
    if (!mainWindow) return null;
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory', 'createDirectory'],
    }) as unknown as { canceled: boolean; filePaths: string[] };
    if (result.canceled) return null;
    return result.filePaths[0] || null;
  });

  ipcMain.handle('open-file-dialog', async () => {
    if (!mainWindow) return null;
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
      filters: [
        { name: 'Videos', extensions: ['mp4', 'mov', 'avi'] },
      ],
    }) as unknown as { canceled: boolean; filePaths: string[] };
    if (result.canceled) return null;
    return result.filePaths[0] || null;
  });

  // New: Credential Management Handlers
  ipcMain.handle('set-credential', async (_event, service: string, account: string, password: string) => {
    try {
      await keytar.setPassword(service, account, password);
      log.info(`Credential set for service: ${service}, account: ${account}`);
      return true;
    } catch (error) {
      const e = error as Error;
      log.error(`Failed to set credential for service: ${service}, account: ${account}`, e.message || String(error));
      return false;
    }
  });

  ipcMain.handle('get-credential', async (_event, service: string, account: string) => {
    try {
      const password = await keytar.getPassword(service, account);
      log.info(`Credential retrieved for service: ${service}, account: ${account}`);
      return password;
    } catch (error) {
      const e = error as Error;
      log.error(`Failed to get credential for service: ${service}, account: ${account}`, e.message || String(error));
      return null;
    }
  });

  ipcMain.handle('delete-credential', async (_event, service: string, account: string) => {
    try {
      const result = await keytar.deletePassword(service, account);
      log.info(`Credential deleted for service: ${service}, account: ${account}. Result: ${result}`);
      return result;
    } catch (error) {
      const e = error as Error;
      log.error(`Failed to delete credential for service: ${service}, account: ${account}`, e.message || String(error));
      return false;
    }
  });

  // Job Manager Handlers
  ipcMain.handle('start-monitoring', () => {
    jobManager.start();
  });

  ipcMain.handle('stop-monitoring', () => {
    jobManager.stop();
  });

  // Immediate initial fetch/backfill trigger from renderer after account addition confirmation
  ipcMain.handle('jobs.startInitialFetch', async (_e, platform: 'x' | 'tiktok' | 'youtube', accountId: string) => {
    try {
      await jobManager.enqueueImmediateBackfill(platform, accountId);
      return true;
    } catch (err) {
      const e = err as Error;
      log.error('[jobs.startInitialFetch] failed:', e.message || String(err));
      return false;
    }
  });

  // 監視対象の全アカウントで最新3件（重複可）のテスト処理を実行
  ipcMain.handle('jobs.testProcessAllOnce', async () => {
    try {
      // テスト実行中は長尺でフリーズしないように強制短尺（約1秒）
      process.env.FORCE_RENDER_DURATION = '1';
      const summary = await jobManager.runTestOnceAll();
      delete process.env.FORCE_RENDER_DURATION;
      log.info('[jobs.testProcessAllOnce] summary:', JSON.stringify(summary));
      return { ok: true, summary } as const;
    } catch (err) {
      const e = err as Error;
      log.error('[jobs.testProcessAllOnce] failed:', e.message || String(err));
      return { ok: false, error: e.message || String(err) } as const;
    }
  });

  ipcMain.handle('get-status', () => jobManager.getStatus());
  // 互換API: 簡易ステータス（renderer.d.ts の IElectronAPI.getStatus に合わせる）
  ipcMain.handle('get-status-simple', () => {
    const full = jobManager.getStatus() as unknown as {
      isRunning: boolean;
      globalQueueSize: number;
      globalPendingTasks: number;
    };
    return {
      isRunning: !!full.isRunning,
      queueSize: Number(full.globalQueueSize || 0),
      pendingTasks: Number(full.globalPendingTasks || 0),
    };
  });

  // Render test generate: use selected video as source (Function B)
  ipcMain.handle('render.testGenerate', async (_e, filePath: string) => {
    try {
      const s = getAllSettings();
      // testOutputPath があれば一時的に差し替え
      const settings: AppSettings = JSON.parse(JSON.stringify(s));
      if (s.general.testOutputPath) settings.general.outputPath = s.general.testOutputPath;
      const out = await generateVideo('', settings, filePath);
      return out;
    } catch (err) {
      const e = err as Error;
      log.error('[render.testGenerate] failed:', e.message || String(err));
      // 追加のヒント: 設定やファイルパスの不備をログに出す
      try {
        const snapshot = getAllSettings();
        log.error('[render.testGenerate] settings snapshot:', JSON.stringify({
          out: snapshot?.general?.testOutputPath || snapshot?.general?.outputPath,
          resolution: snapshot?.render?.resolution,
          duration: snapshot?.render?.durationSec,
          bgm: snapshot?.render?.bgmPath,
          bg: snapshot?.render?.backgroundVideoPath,
        }));
      } catch { /* swallow */ }
      throw (err as Error);
    }
  });

  // 簡易プレビュー（1秒程度）
  ipcMain.handle('render.previewGenerate', async (_e, filePath: string) => {
    try {
      const s = getAllSettings();
      const settings: AppSettings = JSON.parse(JSON.stringify(s));
      if (s.general.testOutputPath) settings.general.outputPath = s.general.testOutputPath;
      // 一時的に durationSec を短くし、プレビュー時のみ強制適用
      settings.render.durationSec = Math.min(2, Math.max(1, settings.render.durationSec || 1));
      const out = await generateVideo('', settings, filePath, { forceDuration: true });
      return out;
    } catch (err) {
      const e = err as Error;
      log.error('[render.previewGenerate] failed:', e.message || String(err));
      throw e;
    }
  });

  ipcMain.handle('check-and-install-dependencies', async (event, dependency: string) => {
    try {
      log.info(`Checking/Installing dependency: ${dependency}`);
      let stdout = '';
      let stderr = '';

      if (dependency === 'node') {
        ({ stdout, stderr } = await runShellCommand('node -v'));
        log.info(`Node.js version: ${stdout.trim()}`);
        if (!stdout.startsWith('v')) {
          throw new Error('Node.js not found or invalid version.');
        }
      } else if (dependency === 'npm') {
        ({ stdout, stderr } = await runShellCommand('npm -v'));
        log.info(`npm version: ${stdout.trim()}`);
        if (!stdout.match(/^\d+\.\d+\.\d+$/)) { // Basic check for version format
          throw new Error('npm not found or invalid version.');
        }
      } else if (dependency === 'ffmpeg') {
        try {
          ({ stdout, stderr } = await runShellCommand('ffmpeg -version'));
          log.info(`FFmpeg version: ${stdout.split('\n')[0].trim()}`);
        } catch (e) {
          log.warn('FFmpeg not found. Attempting to install...');
          if (process.platform === 'win32') {
            // Windows: Try winget or choco
            try {
              await runShellCommand('winget install --id Gyan.FFmpeg');
              log.info('FFmpeg installed via winget.');
            } catch (wingetError) {
              const we = wingetError as Error & { message?: string };
              log.warn(`winget install failed: ${we?.message || String(wingetError)}, trying choco...`);
              await runShellCommand('choco install ffmpeg -y');
              log.info('FFmpeg installed via choco.');
            }
          } else if (process.platform === 'darwin') {
            // macOS: brew
            await runShellCommand('brew install ffmpeg');
            log.info('FFmpeg installed via brew.');
          } else {
            throw new Error('Unsupported OS for automatic FFmpeg installation.');
          }
          // Verify installation
          ({ stdout, stderr } = await runShellCommand('ffmpeg -version'));
          log.info(`FFmpeg version after install: ${stdout.split('\n')[0].trim()}`);
        }
      } else {
        throw new Error(`Unknown dependency: ${dependency}`);
      }
      return { success: true, message: stdout.trim() };
    } catch (error) {
      const e = error as Error & { message: string };
      log.error(`Failed to check/install ${dependency}:`, e.message);
      return { success: false, message: e.message || 'Unknown error' };
    }
  });

  // Add this handler for testScrapeX
  ipcMain.handle('testScrapeX', async (_event, accountId: string) => {
    try {
      const screenshotPath = await scrapeX(accountId);
      return screenshotPath;
    } catch (error) {
      const e = error as Error;
      log.error(`[testScrapeX] failed:`, e.message || String(error));
      return null;
    }
  });
}

const createWindow = () => {
  // Create the browser window.
  const preloadPath = path.join(__dirname, 'preload.cjs');
  log.info('[main] resolved preload path:', preloadPath);
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // and load the index.html of the app.
  // Vite DEV server URL
  const devServerURL = 'http://127.0.0.1:5173';
  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL(devServerURL);
  } else {
    // __dirname => dist/electron/electron
    // renderer   => dist/renderer/index.html
    const rendererIndex = path.join(__dirname, '../../renderer/index.html');
    log.info('[main] loading renderer file:', rendererIndex);
    mainWindow.loadFile(rendererIndex);
  }

  // Open the DevTools.
  if (process.env.NODE_ENV === 'development') {
    mainWindow.webContents.openDevTools();
  }
};

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.on('ready', async () => {
  console.info('[session] start', {
    version: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
    node: process.versions.node,
    electron: process.versions.electron,
    pid: process.pid,
  });
  try { log.info('[argv]', JSON.stringify(process.argv)); } catch { /* ignore */ }
  // Headless mode: environment variable or CLI flags
  const argv = process.argv.slice();
  const getArg = (name: string): string | null => {
    try {
      for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === `--${name}`) return argv[i + 1] || '';
        if (a.startsWith(`--${name}=`)) return a.split('=')[1] || '';
      }
    } catch { /* ignore */ }
    return null;
  };
  const cliCaptureAccount = getArg('capture-x');
  const cliCapture = !!cliCaptureAccount || getArg('capture') === '1';
  const headlessCapture = (process.env.CAPTURE_X_SCREENSHOTS === '1') || cliCapture;
  log.info('[main] capture-detect', { env: process.env.CAPTURE_X_SCREENSHOTS, cliCaptureAccount, cliCapture });
  if (!headlessCapture) {
    createWindow();
  } else {
    log.info('[main] Headless capture mode enabled (CAPTURE_X_SCREENSHOTS=1). Skipping renderer window.');
  }
  setupIpcHandlers();
  try { scheduleDiagnostics(); } catch { /* ignore */ }

  // Ensure Playwright browser is present (first-run install). Await to avoid race with X capture.
  try {
    await ensurePlaywrightInstalled();
  } catch { /* ignore */ }

  // One-off: Capture latest X screenshots on start (env-driven)
  try {
    void (async () => {
  const doCapture = (process.env.CAPTURE_X_SCREENSHOTS === '1') || !!cliCaptureAccount;
  if (!doCapture) return;
  let account = (process.env.CAPTURE_X_ACCOUNT || cliCaptureAccount || '').trim();
      if (!account) {
        try {
          const s = getAllSettings();
          const cand = (s?.platforms?.x?.accounts || []).find((a: any) => a && a.id && a.isActive) || (s?.platforms?.x?.accounts || [])[0];
          account = (cand?.id || '').trim();
        } catch { /* ignore */ }
      }
  const capLimitCli = getArg('capture-limit');
  const limit = Math.max(1, Math.min(10, Number(process.env.CAPTURE_X_LIMIT || capLimitCli) || 5));
      if (!account) {
        log.error('[auto-capture] Missing CAPTURE_X_ACCOUNT. Aborting.');
        return;
      }
      const ts = Date.now();
      // Optional: force output under a specific base directory (e.g., workspace)
  const capBaseRaw = (process.env.CAPTURE_OUT_BASE || getArg('capture-out') || '').trim();
      // Resolve output directory
      let outDir: string;
      try {
        const usePW = process.env.CAPTURE_USE_PLAYWRIGHT === '1';
        const summary: Array<{ id: string; src: string; saved: string; url?: string }>= [];

  // Force Playwright backend path always (ignore non-Playwright legacy path)
  if (true /* usePW forced */) {
          // Build output directory under fixed SCREENSHOT_ROOT/out/screenshots/<account>
          const acctSan = account.startsWith('@') ? account.substring(1) : account;
          const fixedBase = path.join(SCREENSHOT_ROOT, 'out', 'screenshots', acctSan);
          try { mkdirSync(fixedBase, { recursive: true }); } catch { /* ignore */ }
          outDir = fixedBase;
          log.info('[auto-capture] Start: account=' + account + ' limit=' + limit + ' out=' + outDir);
          // Inline Playwright capture to avoid external runner dependency
          let saved = 0;
          try {
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const { chromium } = require('playwright');
            // Use only fixed screenshot auth storage
            const storageStatePath = path.join(SCREENSHOT_ROOT, '.auth', 'x.storage.json');
            const browser = await chromium.launch({ headless: true });
            const context = await browser.newContext({
              storageState: storageStatePath,
              viewport: { width: 1280, height: 800 },
              deviceScaleFactor: 1,
              locale: 'ja-JP',
              colorScheme: 'light',
              userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36',
            });
            const page = await context.newPage();
            await page.goto(`https://x.com/${acctSan}`);
            await page.waitForSelector('article[role="article"]', { timeout: 20000 }).catch(() => {});
            const seen = new Set<string>();
            let idx = 0;
            while (idx < limit) {
              const articles = await page.locator('article[role="article"]').all();
              for (const article of articles) {
                if (idx >= limit) break;
                const link = await article.locator('a[href*="/status/"]').first();
                const href = await link.getAttribute('href');
                const m = href?.match(/\/status\/(\d+)/);
                const tweetId = m ? m[1] : '';
                if (!tweetId || seen.has(tweetId)) continue;
                seen.add(tweetId);
                idx += 1;
                const dest = path.join(outDir, `${String(idx).padStart(2,'0')}-${tweetId}.png`);
                try {
                  await article.screenshot({ path: dest, animations: 'disabled' });
                  summary.push({ id: tweetId, src: dest, saved: dest });
                  saved += 1;
                } catch (e) {
                  idx -= 1; // allow retry on next loop
                }
              }
              if (idx < limit) {
                const last = await page.locator('article[role="article"]').last();
                await last.scrollIntoViewIfNeeded().catch(() => {});
                await page.waitForTimeout(1200);
              }
            }
            await browser.close();
          } catch (e) {
            log.warn('[auto-capture] Playwright path failed:', (e as Error)?.message || String(e));
            // Fallback: spawn external runner script with Node (works in dev workspace)
            try {
              const runner = path.join(process.cwd(), 'scripts', 'run-screenshot-grab.cjs');
              const nodeCmd = process.platform === 'win32' ? 'node.exe' : 'node';
              await new Promise<void>((resolve) => {
                const child = spawn(nodeCmd, [runner, '--user', account, '--count', String(limit), '--outDir', outDir], {
                  cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'], shell: false,
                });
                child.stdout.on('data', (d) => { try { log.info('[screenshot-cli]', d.toString().trim()); } catch {} });
                child.stderr.on('data', (d) => { try { log.warn('[screenshot-cli]', d.toString().trim()); } catch {} });
                child.on('close', () => resolve());
                child.on('error', () => resolve());
              });
              const acctDir = path.join(outDir, acctSan);
              let files = await fs.readdir(acctDir).catch(() => [] as string[]);
              const pngs = files.filter(f => f.toLowerCase().endsWith('.png')).sort();
              let idx2 = summary.length;
              for (const f of pngs) {
                if (summary.length >= limit) break;
                idx2 += 1;
                const src = path.join(acctDir, f);
                const dest = path.join(outDir, `${String(idx2).padStart(2, '0')}-${f.replace(/\.png$/i, '')}.png`);
                try {
                  const buf = await fs.readFile(src);
                  await fs.writeFile(dest, buf);
                  summary.push({ id: f, src, saved: dest });
                } catch { /* ignore */ }
              }
            } catch { /* ignore */ }
          }
          // No other fallback source; fixed directory is the single source of truth now
  }

  await fs.writeFile(path.join(outDir, 'summary.json'), JSON.stringify(summary, null, 2), 'utf8');
  log.info(`[auto-capture] Done. Saved ${summary.length} file(s) to ${outDir}`);
  console.info(`[auto-capture] Done. Saved ${summary.length} file(s) to ${outDir}`);
        // Copy JSONL log for diagnosis
        try {
          await ensureJsonlPath();
          if (jsonlPath) {
            const buf = await fs.readFile(jsonlPath);
            await fs.writeFile(path.join(outDir, 'app.log.jsonl'), buf);
          }
        } catch { /* ignore */ }
      } catch (e) {
        const err = e as Error & { message?: string };
        log.error('[auto-capture] failed:', err?.message || String(e));
      }

      // Optional auto-exit
  const shouldExit = (process.env.CAPTURE_EXIT === '1') || (getArg('capture-exit') !== null);
  if (shouldExit) {
        try { app.exit(0); } catch { /* ignore */ }
      }
    })();
  } catch { /* ignore */ }

  // Optional: Run a one-off test across all accounts on start and save logs into workspace for inspection
  try {
    const runTestOnStart = process.env.RUN_TEST_ON_START === '1';
    if (runTestOnStart) {
      const ts = Date.now();
      // Save under workspace root if available, else under userData
      let outDir = path.join(process.cwd(), 'test-results', `auto-run-${ts}`);
      try { mkdirSync(outDir, { recursive: true }); } catch { /* ignore */ }
      // Fallback if mkdir failed (e.g., CWD not writable)
      if (!existsSyncFS(outDir)) {
        outDir = path.join(app.getPath('userData'), 'test-results', `auto-run-${ts}`);
        try { mkdirSync(outDir, { recursive: true }); } catch { /* ignore */ }
      }

      // Seed: テスト用アカウント/設定を自動投入（フェーズ2仕様）
      try {
        const s = getAllSettings();
        const next = JSON.parse(JSON.stringify(s)) as AppSettings;
        // 有効化 & 監視対象アカウント（各1アカウント）を投入
        next.platforms.x = {
          enabled: true,
          intervalMinutes: s.platforms.x?.intervalMinutes ?? 15,
          scrapeDelayMs: s.platforms.x?.scrapeDelayMs ?? 5000,
          accounts: [
      { id: 'Mountain_cb', isActive: true, backfillRemaining: 0, processedIds: [], lastCursor: '' },
          ],
        } as any;
        next.platforms.tiktok = {
          enabled: true,
          intervalMinutes: s.platforms.tiktok?.intervalMinutes ?? 15,
          scrapeDelayMs: s.platforms.tiktok?.scrapeDelayMs ?? 5000,
          accounts: [
            { id: 'sonnawakenai.ai', isActive: true, backfillRemaining: 0, processedIds: [], lastCursor: '' },
          ],
        } as any;
        next.platforms.youtube = {
          enabled: true,
          intervalMinutes: s.platforms.youtube?.intervalMinutes ?? 15,
          scrapeDelayMs: s.platforms.youtube?.scrapeDelayMs ?? 5000,
          accounts: [
            { id: 'BMYuya', isActive: true, backfillRemaining: 0, processedIds: [], lastCursor: '' },
          ],
        } as any;
        // 出力先を今回の auto-run ディレクトリに統一
        next.general.outputPath = outDir;
        // 3秒に短縮して強制適用（generateVideo は FORCE_RENDER_DURATION=1 のとき durationSec を厳守）
        next.render.durationSec = 3;
        // 背景映像（Xスクショ合成に必須）を既定のテスト動画に設定（存在する場合）
        try {
          const bgCandidate = path.join(process.cwd(), 'test-data', 'background.mp4');
          if (existsSyncFS(bgCandidate)) {
            next.render.backgroundVideoPath = bgCandidate;
            log.info('[auto-run] Set backgroundVideoPath:', bgCandidate);
          } else {
            log.warn('[auto-run] background video not found at', bgCandidate, '- X screenshot overlay may fail without a background video.');
          }
        } catch { /* ignore */ }
        setSettingsPatch(next as Partial<AppSettings>);
        log.info('[auto-run] Seeded test accounts and forced duration=3s. Output:', outDir);
      } catch (e) {
        log.warn('[auto-run] seeding test accounts failed:', (e as Error)?.message || String(e));
      }

  // 自動テスト実行時も短尺を強制
  process.env.FORCE_RENDER_DURATION = '1';
  jobManager.runTestOnceAll()
        .then(async (summary) => {
          try {
            await fs.writeFile(path.join(outDir, 'summary.json'), JSON.stringify(summary, null, 2), 'utf8');
          } catch { /* ignore */ }
          try {
            await ensureJsonlPath();
            if (jsonlPath) {
              const buf = await fs.readFile(jsonlPath);
              await fs.writeFile(path.join(outDir, 'app.log.jsonl'), buf);
            }
          } catch { /* ignore */ }
          log.info('[auto-run] testProcessAllOnce summary saved to:', outDir);
          // 片付け
          try { delete process.env.FORCE_RENDER_DURATION; } catch { /* ignore */ }
          // オプション: 自動終了
          try {
            if (process.env.RUN_TEST_EXIT === '1') {
              log.info('[auto-run] RUN_TEST_EXIT=1 set. Exiting app...');
              app.exit(0);
            }
          } catch { /* ignore */ }
        })
        .catch((e) => {
          const err = e as Error;
          log.error('[auto-run] testProcessAllOnce failed:', err.message || String(e));
          // 片付け
          try { delete process.env.FORCE_RENDER_DURATION; } catch { /* ignore */ }
          // オプション: 自動終了（失敗コード）
          try {
            if (process.env.RUN_TEST_EXIT === '1') {
              log.info('[auto-run] RUN_TEST_EXIT=1 set. Exiting app with code 1...');
              app.exit(1);
            }
          } catch { /* ignore */ }
        });
    }
  } catch {
    /* ignore */
  }

  // Debug: Global shortcut to test open-file dialog directly from main
  try {
    globalShortcut.register('Control+Shift+B', async () => {
      try {
        const win = mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined;
        let res: { canceled: boolean; filePaths: string[] };
        if (win) {
          res = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: [{ name: 'Videos', extensions: ['mp4', 'mov', 'avi', 'mkv', 'webm'] }] }) as unknown as { canceled: boolean; filePaths: string[] };
        } else {
          res = await dialog.showOpenDialog({ properties: ['openFile'], filters: [{ name: 'Videos', extensions: ['mp4', 'mov', 'avi', 'mkv', 'webm'] }] }) as unknown as { canceled: boolean; filePaths: string[] };
        }
        if (!res.canceled) {
          log.info('[shortcut] picked:', res.filePaths[0]);
        } else {
          log.info('[shortcut] canceled');
        }
      } catch (e) {
        log.warn('[shortcut] open-file failed:', (e as Error)?.message || String(e));
      }
    });
  } catch {
    /* ignore */
  }

  // Optional: auto-generate a short preview on start for testing
  try {
    const previewOnStart = process.env.PREVIEW_ON_START === '1';
    // Resolve PREVIEW_FILE robustly
    let previewFile = process.env.PREVIEW_FILE || '';
    try {
      if (previewFile) {
        if (!path.isAbsolute(previewFile)) {
          // Resolve relative to CWD first (workspace root in dev), then dist root
          const appRoot = path.resolve(__dirname, '..');
          const relCwd = path.resolve(process.cwd(), previewFile);
          const relDist = path.resolve(appRoot, previewFile);
          if (existsSyncFS(relCwd)) previewFile = relCwd;
          else if (existsSyncFS(relDist)) previewFile = relDist;
          else previewFile = relCwd; // fallback to CWD
        }
        log.info('[auto-preview] PREVIEW_FILE:', previewFile);
      }
    } catch {
      /* ignore */
    }
    const previewExit = process.env.PREVIEW_EXIT === '1';
    if (previewOnStart && previewFile) {
      const s = getAllSettings();
      const settings: AppSettings = JSON.parse(JSON.stringify(s));
      // Force auto-preview outputs into workspace test-results/auto-preview for easy verification
      try {
        const apDir = path.join(process.cwd(), 'test-results', 'auto-preview');
        mkdirSync(apDir, { recursive: true });
        settings.general.outputPath = apDir;
      } catch { /* ignore */ }
      settings.render.durationSec = Math.min(2, Math.max(1, settings.render.durationSec || 1));
      generateVideo('', settings, previewFile)
        .then((out) => {
          log.info('[auto-preview] generated:', out);
          console.info('[auto-preview] generated:', out);
        })
        .catch((e) => {
          log.error('[auto-preview] failed:', (e as Error)?.message || String(e));
          console.error('[auto-preview] failed:', (e as Error)?.message || String(e));
          if (previewExit) {
            try { app.exit(1); } catch { /* ignore */ }
          }
        });
    }
  } catch (e) {
    const err = e as Error;
    log.warn('[auto-preview] setup failed:', err.message || String(e));
  }
});

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  try { globalShortcut.unregisterAll(); } catch { /* ignore */ }
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and import them here.

// Global error handlers to always log unexpected errors
process.on('uncaughtException', (err) => {
  log.error('[uncaughtException]', err?.stack || err?.message || String(err));
});
process.on('unhandledRejection', (reason) => {
  const r = reason as Error & { stack?: string; message?: string };
  log.error('[unhandledRejection]', r?.stack || r?.message || String(reason));
});

app.on('render-process-gone', (_event, webContents, details) => {
  log.error('[render-process-gone]', details?.reason || 'unknown');
});

// 診断ログの定期出力
function scheduleDiagnostics() {
  try {
    const s = getAllSettings();
    const enabled = !!s?.general?.diagnosticLogging;
    const intervalMs = enabled ? Math.max(2000, Math.floor((s.general.diagnosticIntervalSec ?? 10) * 1000)) : 0;

    // 変更がなければ何もしない（スパム抑制）
    if (enabled === lastDiagEnabled && intervalMs === lastDiagIntervalMs && diagTimer) {
      return;
    }

    // 既存のタイマーをクリア
    if (diagTimer) {
      clearInterval(diagTimer);
      diagTimer = null;
    }

    // 無効なら終了
    if (!enabled) {
      lastDiagEnabled = false;
      lastDiagIntervalMs = 0;
      return;
    }

    // 新しい設定で開始
    diagTimer = setInterval(() => {
      try {
        const snapshot = (store as unknown as { store: AppSettings }).store;
        const status = jobManager.getStatus();
        log.info('[diagnostic] status:', JSON.stringify(status));
        log.info('[diagnostic] settings:', JSON.stringify({
          out: snapshot?.general?.outputPath,
          testOut: snapshot?.general?.testOutputPath,
          resolution: snapshot?.render?.resolution,
          duration: snapshot?.render?.durationSec,
          scale: snapshot?.render?.scale,
          bgm: !!snapshot?.render?.bgmPath,
          bgVideo: !!snapshot?.render?.backgroundVideoPath,
          platforms: Object.fromEntries(
            Object.entries(snapshot?.platforms || {}).map(([k, v]) => {
              const vv = v as { enabled?: boolean; accounts?: unknown[]; intervalMinutes?: number };
              return [k, { enabled: !!vv?.enabled, accounts: vv?.accounts?.length ?? 0, intervalMinutes: vv?.intervalMinutes }];
            })
          ),
        }));
      } catch (e) {
        const err = e as Error;
        log.warn('[diagnostic] emit failed:', err.message || String(e));
      }
    }, intervalMs);
    lastDiagEnabled = true;
    lastDiagIntervalMs = intervalMs;
    log.info(`[diagnostic] enabled. interval=${intervalMs}ms`);
  } catch (e) {
    const err = e as Error;
    log.warn('[diagnostic] scheduling failed:', err.message || String(e));
  }
}


