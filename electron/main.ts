import { app, BrowserWindow, ipcMain, dialog, globalShortcut } from 'electron';
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

// Configure logger
log.initialize();
log.transports.file.level = 'info';
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
      instagram: {
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

  // JSONL logs: file path
  ipcMain.handle('logs.jsonlFile', async () => {
    try {
      await ensureJsonlPath();
      return jsonlPath || '';
    } catch {
      return '';
    }
  });

  // JSONL logs: read full or tail
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
      properties: ['openDirectory', 'createDirectory']
  }) as unknown as { canceled: boolean; filePaths: string[] };
  if (result.canceled) return null;
  return result.filePaths[0] || null;
  });

  ipcMain.handle('open-file-dialog', async () => {
    if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
      filters: [
        { name: 'Videos', extensions: ['mp4', 'mov', 'avi'] }
      ]
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
  ipcMain.handle('jobs.startInitialFetch', async (_e, platform: 'x'|'tiktok'|'instagram'|'youtube', accountId: string) => {
    try {
      await jobManager.enqueueImmediateBackfill(platform, accountId);
      return true;
    } catch (err) {
      const e = err as Error;
      log.error('[jobs.startInitialFetch] failed:', e.message || String(err));
      return false;
    }
  });

  // 監視対象の全アカウントで最新1件のテスト処理を実行
  ipcMain.handle('jobs.testProcessAllOnce', async () => {
    try {
      const summary = await jobManager.runTestOnceAll();
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
app.on('ready', () => {
  console.info('[session] start', {
    version: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
    node: process.versions.node,
    electron: process.versions.electron,
    pid: process.pid,
  });
  createWindow();
  setupIpcHandlers();
  try { scheduleDiagnostics(); } catch { /* ignore */ }

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
        })
        .catch((e) => {
          const err = e as Error;
          log.error('[auto-run] testProcessAllOnce failed:', err.message || String(e));
        });
    }
  } catch { /* ignore */ }

  // Debug: Global shortcut to test open-file dialog directly from main
  try {
    globalShortcut.register('Control+Shift+B', async () => {
      try {
        const win = mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined;
        let res: { canceled: boolean; filePaths: string[] };
        if (win) {
          res = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: [{ name: 'Videos', extensions: ['mp4','mov','avi','mkv','webm'] }] }) as unknown as { canceled: boolean; filePaths: string[] };
        } else {
          res = await dialog.showOpenDialog({ properties: ['openFile'], filters: [{ name: 'Videos', extensions: ['mp4','mov','avi','mkv','webm'] }] }) as unknown as { canceled: boolean; filePaths: string[] };
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
  } catch { /* ignore */ }

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
    } catch { /* ignore */ }
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
          if (previewExit) {
            try { app.quit(); } catch { /* ignore */ }
          }
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
          )
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
