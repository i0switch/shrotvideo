// @ts-nocheck
import {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  globalShortcut,
} from 'electron';
// NOTE: Tab Capture 拡張 (electron/tabcapture-extension) を将来 Playwright persistent context にアタッチ予定。
// ここではまだ Electron BrowserWindow へ直接ロードはしない（Chrome 拡張API未対応のため）。
import { exec } from 'child_process';
import './login';
import './dialogs';
import path from 'path';
    // 事前に exit トレースをテスト結果フォルダ(events.log と同階層)にフラッシュ
    try {
      if (process.env.TEST_DEBUG_FILE) {
        const outDirPre = path.dirname(process.env.TEST_DEBUG_FILE);
        const preFile = path.join(outDirPre, 'exit-reasons-pre.json');
        fs.writeFile(preFile, JSON.stringify({ traces: exitTraces, finalCode: code, phase: 'pre-exit' }, null, 2)).catch(()=>{});
      }
    } catch { /* ignore */ }
import fs from 'node:fs/promises';
import { existsSync as existsSyncFS, mkdirSync } from 'node:fs';
// import { fileURLToPath } from 'url';
import Store from 'electron-store';
import type { AppSettings } from '../src/core/settings.js';
import { JobManager } from './job-manager.js';
import log from 'electron-log';
import type { LogMessage } from 'electron-log';
import * as keytar from 'keytar'; // Add this line
// Legacy generateVideo deprecated: unify on finalizeMedia pipeline
import { finalizeMedia } from './utils/finalize-media.js';
import { scrapeX } from './tasks/scraper.js'; // listRecentItems 未使用のため削除でlint警告低減
import { downloadVideoToTemp } from './tasks/downloader.js';
import { spawn } from 'node:child_process';
import chokidar from 'chokidar';
import type { Platform } from '../src/core/settings.js';
import { resolveTemplateFor, applyTemplateToSettings } from './utils/templates';
import { mediaProbe } from './utils/media-probe.js';
import { structuredLog, getStructuredLogPath } from './utils/structured-log.js';
import { aggregateStructuredLogMetrics } from './utils/metrics-aggregate.js';
import { getHealthStatus, setMediaHealth, startBrowserSelfTestScheduler, triggerBrowserSelfTest, onBrowserSelfTest } from './utils/health-status.js';

// Configure logger
log.initialize();
log.transports.file.level = 'debug';
// App identity: ensure consistent name & AppUserModelId (affects userData folder, notifications, etc.)
try { app.setName('ShortVideo-Genius'); } catch { /* ignore */ }
try { app.setAppUserModelId('com.gemini.shortvideogenius'); } catch { /* ignore */ }
// Force userData path to a stable folder name regardless of package.json "name"
try {
  const userDataDir = path.join(app.getPath('appData'), 'ShortVideo-Genius');
  app.setPath('userData', userDataDir);
  // Also pin cache/gpuCache/temp under userData to avoid OneDrive/permission conflicts
  const safeMkdir = (p: string) => { try { require('node:fs').mkdirSync(p, { recursive: true }); } catch { /* ignore */ } };
  const cacheDir = path.join(userDataDir, 'Cache');
  const gpuCacheDir = path.join(userDataDir, 'GPUCache');
  const tmpDir = path.join(userDataDir, 'Tmp');
  safeMkdir(cacheDir); safeMkdir(gpuCacheDir); safeMkdir(tmpDir);
  try { app.setPath('cache', cacheDir); } catch { /* ignore */ }
  try { app.setPath('gpuCache', gpuCacheDir as unknown as any); } catch { /* ignore */ }
  try { app.setPath('temp', tmpDir); } catch { /* ignore */ }
} catch { /* ignore */ }
// Offscreen capture stability on some Windows setups
try { app.disableHardwareAcceleration(); } catch { /* ignore */ }
// Duplicate logs to JSONL file and forward to renderer
let jsonlPath: string | null = null;
let jsonlInit = false;
// Startup media health probe: validates presence & basic media characteristics of bundled assets (haikei/chroma)
// Updates healthStatus.media with aggregated result. Non-fatal: failures logged but do not crash app.
async function runStartupMediaProbe() {
  try {
    const assets: Array<{ key: string; file: string; type: 'video' | 'image'; probe?: any; exists: boolean } > = [];
    const root = app.getAppPath ? app.getAppPath() : process.cwd();
    const candidateFiles = [
      { key: 'background', names: ['haikei.mp4', 'background.mp4'] },
      { key: 'chromaVideo', names: ['kuroma.mp4'] },
      { key: 'chromaImage', names: ['kuroma.png'] },
    ];
    for (const group of candidateFiles) {
      let foundPath: string | null = null;
      for (const name of group.names) {
        const p = path.isAbsolute(name) ? name : path.join(root, name);
        if (existsSyncFS(p)) { foundPath = p; break; }
      }
      if (!foundPath) {
        assets.push({ key: group.key, file: group.names[0], type: group.key === 'chromaImage' ? 'image' : 'video', exists: false });
        continue;
      }
      const isImage = /\.(png|jpg|jpeg)$/i.test(foundPath);
      let probeRes: any = undefined;
      if (!isImage) {
        try { probeRes = await mediaProbe(foundPath).catch(() => null); } catch { /* ignore */ }
      }
      assets.push({ key: group.key, file: foundPath, type: isImage ? 'image' : 'video', probe: probeRes, exists: true });
    }
    const background = assets.find(a => a.key === 'background');
    const chromaVid = assets.find(a => a.key === 'chromaVideo');
    const chromaImg = assets.find(a => a.key === 'chromaImage');
    const okBackground = !!(background && background.exists && background.probe && background.probe.hasVideo);
    const okChroma = !!( (chromaVid && chromaVid.exists && chromaVid.probe && chromaVid.probe.hasVideo) || (chromaImg && chromaImg.exists) );
    const overallOk = okBackground && okChroma;
    setMediaHealth({
      ok: overallOk,
      detail: {
        assets: assets.map(a => ({
          key: a.key,
          file: a.file,
          exists: a.exists,
          type: a.type,
          probe: a.probe ? {
            hasAudio: a.probe.hasAudio,
            hasVideo: a.probe.hasVideo,
            width: a.probe.width,
            height: a.probe.height,
            durationSec: a.probe.durationSec,
            method: a.probe.method,
          } : undefined,
        })),
        okBackground,
        okChroma,
      },
    });
    try { log.info('[health] startup media probe', JSON.stringify((getHealthStatus().media || {}).detail)); } catch { /* ignore */ }
  } catch (e) {
    setMediaHealth({ ok: false, detail: { assets: [], okBackground: false, okChroma: false, error: (e as Error)?.message || String(e) }, error: (e as Error)?.message || String(e) });
    log.warn('[health] startup media probe failed:', (e as Error)?.message || String(e));
  }
}
const ensureJsonlPath = () => {
  if (jsonlInit && jsonlPath) return;
  try {
    const dir = path.join(app.getPath('userData'), 'logs');
    try { mkdirSync(dir, { recursive: true }); } catch { /* ignore */ }
    jsonlPath = path.join(dir, 'app.log.jsonl');
    jsonlInit = true;
  } catch {
    // ignore
  }
};

// ---- 安全終了ラッパー: 予期しない自動終了原因の特定を容易に ----
function safeAutoExit(code: number) {
  try {
    const marker = `[auto-exit] code=${code} RUN_TEST_EXIT=${process.env.RUN_TEST_EXIT} NO_AUTO_EXIT=${process.env.NO_AUTO_EXIT}`;
    log.info(marker);
    if (process.env.NO_AUTO_EXIT === '1') {
      log.info('[auto-exit] NO_AUTO_EXIT=1 により exit 抑止');
      return;
    }
    try {
      app.exit(code);
    } catch (e2) {
      // app.exit が失敗するケース(まれ)は process.exit にフォールバック
      try { log.warn('[auto-exit] app.exit 失敗のため process.exit フォールバック'); } catch {}
      try { process.exit(code); } catch { /* ignore */ }
    }
  } catch (e) {
    try { log.error('[auto-exit] exit 失敗:', (e as Error)?.message || String(e)); } catch {}
  }
}

// ---- 終了経路トレース ----
interface ExitTrace { ts: string; phase: string; detail?: any; code?: number; reason?: string; }
const exitTraces: ExitTrace[] = [];
function pushExitTrace(t: Omit<ExitTrace,'ts'>) {
  try {
    const rec: ExitTrace = { ts: new Date().toISOString(), ...t };
    exitTraces.push(rec);
    log.info('[exit-trace]', JSON.stringify(rec));
  } catch {/* ignore */}
}

process.on('beforeExit', (code) => pushExitTrace({ phase: 'process.beforeExit', code }));
process.on('exit', (code) => {
  pushExitTrace({ phase: 'process.exit', code });
  // 直前でまとめてファイルへ
  try {
    ensureJsonlPath();
    if (jsonlPath) {
      const out = path.join(path.dirname(jsonlPath), 'exit-reasons.json');
      fs.writeFile(out, JSON.stringify({ traces: exitTraces }, null, 2)).catch(()=>{});
    }
  } catch { /* ignore */ }
});
app.on('will-quit', () => pushExitTrace({ phase: 'app.will-quit' }));
app.on('before-quit', (e) => pushExitTrace({ phase: 'app.before-quit', detail: { defaultPrevented: e.defaultPrevented } }));
app.on('render-process-gone', (_e, _wc, d) => pushExitTrace({ phase: 'render-process-gone', reason: d?.reason }));

// Hook: also write each log entry as JSONL for dashboard consumption
try {
  // lazy ensure path once at startup
  ensureJsonlPath();
  // electron-log v5: hooks for every transport
  (log.hooks as unknown as Array<(message: LogMessage) => void>).push((message: LogMessage) => {
    try {
      const entry = {
        time: new Date().toISOString(),
        level: String((message as any)?.level || '').toLowerCase(),
        // message.data is array of unknowns; stringify safely
        message: Array.isArray((message as any)?.data)
          ? ((message as any).data as unknown[]).map((d) => {
              try { return typeof d === 'string' ? d : JSON.stringify(d); } catch { return String(d); }
            }).join(' ')
          : String((message as any)?.data ?? ''),
      } as { time: string; level: string; message: string };
      if (!jsonlPath) return;
      // append line (best-effort)
      fs.writeFile(jsonlPath, JSON.stringify(entry) + '\n', { flag: 'a' }).catch(() => {});
      
      // Send log message to renderer if main window is available
      if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents) {
        const formattedMessage = `[${entry.level.toUpperCase()}] ${entry.time}: ${entry.message}`;
        mainWindow.webContents.send('log-message', formattedMessage);
      }
    } catch {
      /* swallow */
    }
  });
} catch { /* ignore */ }

let mainWindow: BrowserWindow | null = null;
let diagTimer: NodeJS.Timeout | null = null;
let lastDiagEnabled = false;
let lastDiagIntervalMs = 0;
const pendingSelfTestEvents: Array<Record<string, unknown>> = [];

function flushPendingSelfTestEvents() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (!pendingSelfTestEvents.length) return;
  try {
    const events = pendingSelfTestEvents.splice(0, pendingSelfTestEvents.length);
    for (const evt of events) {
      try { mainWindow.webContents.send('health:self-test', evt); } catch { /* ignore send */ }
    }
  } catch {
    /* ignore flush errors */
  }
}

// ---- Settings store and helpers ----
const defaultSettings: AppSettings = {
  general: {
    outputPath: '',
    testOutputPath: '',
    diagnosticLogging: false,
    diagnosticIntervalSec: 10,
    initialBackfillCount: 0,
    chromaDefaultSimilarity: 0.25,
    chromaDefaultBlend: 0.05,
  },
  watcher: {
    enabled: false,
    inputDir: '',
    outputDir: '',
    glob: '**/*.{mp4,mov,mkv,webm}',
    debounceMs: 1500,
  },
  templates: { items: {}, selection: { byAccount: {}, byPlatform: { x: [], tiktok: [], youtube: [] }, fallback: [] } as any },
  platforms: {
  x: { enabled: false, accounts: [], intervalMinutes: 15, scrapeDelayMs: 5000, chroma: { enabled: false, mode: 'fixed', foregroundPath: '', foregroundDir: '' } as any },
  tiktok: { enabled: false, accounts: [], intervalMinutes: 15, scrapeDelayMs: 5000, chroma: { enabled: false, mode: 'fixed', foregroundPath: '', foregroundDir: '' } as any },
  youtube: { enabled: false, accounts: [], intervalMinutes: 15, scrapeDelayMs: 5000, chroma: { enabled: false, mode: 'fixed', foregroundPath: '', foregroundDir: '' } as any },
  },
  render: {
    resolution: { width: 1080, height: 1920 },
    durationSec: 15,
    bgmPath: '',
    backgroundVideoPath: '',
  scale: 0.9,
    qualityPreset: 'standard',
    overlayPosition: 'center',
  },
};

const store = new Store<AppSettings>({ defaults: defaultSettings } as any);

function setSettingsPatch(patch: Partial<AppSettings>) {
  try {
    const current = (store as unknown as { store: AppSettings }).store || ({} as any);
    const merged = deepMergeReplaceArrays(current, patch);
    (store as unknown as { store: AppSettings }).store = merged as AppSettings;
  } catch { /* ignore */ }
}

function deepMergeReplaceArrays(target: any, source: any): any {
  if (source == null) return target;
  if (typeof source !== 'object') return source;
  const out: any = Array.isArray(target) ? [] : { ...target };
  for (const key of Object.keys(source)) {
    const sv = source[key];
    const tv = (target || {})[key];
    if (Array.isArray(sv)) out[key] = sv.slice();
    else if (sv && typeof sv === 'object') out[key] = deepMergeReplaceArrays(tv && typeof tv === 'object' ? tv : {}, sv);
    else out[key] = sv;
  }
  return out;
}

const jobManager = new JobManager(store);

type AutoPauseState = {
  active: boolean;
  since?: string;
  reason?: string;
  source?: string;
};

type BrowserSelfTestBroadcastBase = {
  result: 'success' | 'failure' | 'busy';
  source: string;
  timestamp: string;
  failureStreak: number;
  autoDisabled: boolean;
  autoDisabledTriggered: boolean;
  reason?: string;
  autoAction?: 'paused' | 'resumed' | 'manual-resume';
  jobManagerWasRunning?: boolean;
};

const autoPauseState: AutoPauseState = { active: false };

function broadcastSelfTestEvent(base: BrowserSelfTestBroadcastBase) {
  const payload = {
    ...base,
    autoPaused: autoPauseState.active,
    autoPauseReason: autoPauseState.reason ?? undefined,
    autoPauseSince: autoPauseState.since ?? undefined,
    autoPauseSource: autoPauseState.source ?? undefined,
  } as Record<string, unknown>;
  try {
    structuredLog.emit('health:self-test', {
      result: base.result,
      source: base.source,
      failureStreak: base.failureStreak,
      autoDisabled: base.autoDisabled,
      autoDisabledTriggered: base.autoDisabledTriggered,
      autoPaused: autoPauseState.active,
      autoAction: base.autoAction,
      reason: base.reason,
      jobManagerWasRunning: base.jobManagerWasRunning,
    });
  } catch {
    /* ignore structured log failure */
  }
  if (mainWindow && !mainWindow.isDestroyed()) {
    try { mainWindow.webContents.send('health:self-test', payload); } catch { /* ignore send */ }
  } else {
    pendingSelfTestEvents.push(payload);
    if (pendingSelfTestEvents.length > 100) pendingSelfTestEvents.shift();
  }
}

const cleanupBrowserSelfTestListener = onBrowserSelfTest((event) => {
  let autoAction: 'paused' | 'resumed' | 'manual-resume' | undefined;
  let jobManagerWasRunning = false;

  if (event.autoDisabledTriggered) {
    autoPauseState.active = true;
    autoPauseState.reason = event.reason ?? autoPauseState.reason ?? 'launch-failure';
    autoPauseState.source = event.source;
    autoPauseState.since = event.timestamp;
    try {
      const status = jobManager.getStatus();
      jobManagerWasRunning = !!(status && typeof status.isRunning === 'boolean' && status.isRunning);
    } catch {
      jobManagerWasRunning = false;
    }
    if (jobManagerWasRunning) {
      try { log.warn('[health] browser self-test failure triggered automatic monitoring stop', { failureStreak: event.failureStreak, source: event.source, reason: event.reason }); } catch { /* ignore */ }
      try { jobManager.stop(); } catch (err) {
        try { log.warn('[health] jobManager.stop failed after auto-stop trigger', (err as Error)?.message || String(err)); } catch { /* ignore */ }
      }
    }
    autoAction = 'paused';
    try {
      structuredLog.emit('monitor:auto-paused', {
        failureStreak: event.failureStreak,
        source: event.source,
        reason: event.reason,
      });
    } catch {
      /* ignore structured log failure */
    }
  } else if (event.autoDisabled) {
    autoPauseState.active = true;
    autoPauseState.reason = event.reason ?? autoPauseState.reason;
    autoPauseState.source = event.source ?? autoPauseState.source;
    autoPauseState.since = autoPauseState.since ?? event.timestamp;
  } else if (autoPauseState.active && event.result === 'success') {
    autoPauseState.active = false;
    autoPauseState.reason = undefined;
    autoPauseState.source = undefined;
    autoPauseState.since = undefined;
    autoAction = 'resumed';
    try {
      structuredLog.emit('monitor:auto-resumed', {
        source: event.source,
        method: 'self-test',
      });
    } catch {
      /* ignore structured log failure */
    }
  }

  broadcastSelfTestEvent({ ...event, autoAction, jobManagerWasRunning });
});

app.on('will-quit', () => {
  try { cleanupBrowserSelfTestListener(); } catch { /* ignore */ }
});

async function runShellCommand(command: string): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    try {
      exec(command, { windowsHide: true }, (error, stdout, stderr) => {
        if (error) return reject(error);
        resolve({ stdout: String(stdout || ''), stderr: String(stderr || '') });
      });
    } catch (e) {
      reject(e);
    }
  });
}

// Safe stat helper used in packaged-path detection
async function fsStatSafe(p: string): Promise<boolean> {
  try { const st = await fs.stat(p); return !!st; } catch { return false; }
}

// Ensure Playwright browsers are installed (idempotent). Install into userData\ms-playwright.
// We install both chromium and (if available) chrome channel to support X 再生互換対策 (Chrome Stable 推奨)。
async function ensurePlaywrightInstalled(): Promise<void> {
  // Helper: resolve a usable playwright CLI.js path
  const resolvePlaywrightCli = (): string | null => {
    try {
      // Preferred: playwright as a dependency
       
      const pwPkg = require.resolve('playwright/package.json');
      return path.join(path.dirname(pwPkg), 'cli.js');
    } catch {
      // Fallback: playwright bundled under @playwright/test's node_modules
      try {
         
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
    const installTargets = ['chromium','chrome'];
    for (const target of installTargets) {
      await new Promise<void>((resolve) => {
      try {
        const child = spawn(exe, [cliJs, 'install', target], { env, stdio: ['ignore', 'ignore', 'pipe'] });
        let warned = false;
        child.stderr.on('data', (d) => { if (!warned) { warned = true; log.info(`[playwright-install:${target}]`, String(d).trim()); } });
        child.on('close', () => resolve());
        child.on('error', () => resolve());
      } catch {
        resolve();
      }
      });
    }
  } catch (e) {
    // If CLI cannot be resolved (e.g., missing dependency), just continue; later capture code will fail and log
    log.warn('[playwright-install] skipped due to error:', (e as Error)?.message || String(e));
  }
}

// Dynamic screenshot root: env SCREENSHOT_ROOT if absolute; otherwise userData/screenshot (fallback to temp on failure)
import os from 'node:os';
function getScreenshotRoot(): string {
  const fromEnv = process.env.SCREENSHOT_ROOT;
  if (fromEnv && path.isAbsolute(fromEnv)) return fromEnv;
  try {
    return path.join(app.getPath('userData'), 'screenshot');
  } catch {
    return path.join(os.tmpdir(), 'ShortVideo-Genius-screenshot');
  }
}

// Resolve a usable Playwright browsers directory for packaged/runtime use
async function resolvePlaywrightBrowsersDir(): Promise<string> {
  try {
    // Prefer ms-playwright under userData if ensurePlaywrightInstalled ran
    const msPw = path.join(app.getPath('userData'), 'ms-playwright');
    if (await fsStatSafe(msPw)) return msPw;
  } catch { /* ignore */ }
  try {
    // Next, try packaged .local-browsers under app.asar.unpacked
    const exeDir = path.dirname(process.execPath);
    const resourcesDir = (process as any).resourcesPath || path.join(exeDir, 'resources');
    const unpackedDir = path.join(resourcesDir, 'app.asar.unpacked');
    const browsersDirA = path.join(unpackedDir, 'node_modules', 'playwright-core', '.local-browsers');
    if (await fsStatSafe(browsersDirA)) return browsersDirA;
    // Secondary guess by replacing app.asar -> app.asar.unpacked
    const appPathNow = app.getAppPath();
    const unpackedAlt = appPathNow.replace(/app\.asar(\\|\/)?$/i, 'app.asar.unpacked');
    const browsersDirB = path.join(path.dirname(unpackedAlt), 'node_modules', 'playwright-core', '.local-browsers');
    if (await fsStatSafe(browsersDirB)) return browsersDirB;
  } catch { /* ignore */ }
  return '';
}

// Strict helpers for electron-store access
function getAllSettings(): AppSettings {
  return (store as unknown as { store: AppSettings }).store;
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

  // Structured log metrics (lightweight in-process parse of last N lines)
  ipcMain.handle('logs.metrics', async (_e, opts?: { maxLines?: number }) => {
    try {
      const p = getStructuredLogPath();
      if (!p || !require('node:fs').existsSync(p)) return { ok: false, reason: 'not-found' };
      const maxLines = Math.max(50, Math.min(5000, (opts?.maxLines ?? 1000)));
      const raw = require('node:fs').readFileSync(p, 'utf-8').trim().split(/\r?\n/);
      const slice = raw.slice(-maxLines);
      const recs: any[] = [];
      for (const l of slice) { try { recs.push(JSON.parse(l)); } catch { /* ignore */ } }
      const agg = aggregateStructuredLogMetrics(recs);
      // Settings から閾値を引き込み、既定と併せて返却（UI カラー分岐用）
      const s = getAllSettings();
      const th = s?.general?.metricsThresholds || {};
      const thresholds = {
        bgmFailWarnPct: th.bgmFailWarnPct ?? 1,
        bgmFailErrorPct: th.bgmFailErrorPct ?? 10,
        chromaAboveWarnPct: th.chromaAboveWarnPct ?? 5,
        chromaAboveErrorPct: th.chromaAboveErrorPct ?? 15,
        multiMaxOverWarnPct: th.multiMaxOverWarnPct ?? 5,
        multiMaxOverErrorPct: th.multiMaxOverErrorPct ?? 15,
        multiP95OverWarnPct: th.multiP95OverWarnPct ?? 5,
        multiP95OverErrorPct: th.multiP95OverErrorPct ?? 15,
      };
      // メトリクススナップショットを一定頻度で保存 (最大 200 行)
      try {
        if (!jsonlPath) ensureJsonlPath();
        const snapDir = path.join(app.getPath('userData'), 'metrics');
        try { mkdirSync(snapDir, { recursive: true }); } catch {}
        const snapFile = path.join(snapDir, 'metrics-snapshots.jsonl');
        // 60秒に1回程度 (簡易): 直近ファイル mtime から判定
        let write = false;
        try {
          const st = require('node:fs').statSync(snapFile);
          if (Date.now() - st.mtimeMs > 60_000) write = true;
        } catch { write = true; }
        if (write) {
          const line = JSON.stringify({ ts: new Date().toISOString(), ...agg }) + '\n';
          require('node:fs').appendFileSync(snapFile, line);
          // Trim if >200 lines
          try {
            const rawSnap = require('node:fs').readFileSync(snapFile, 'utf-8').trim().split(/\r?\n/);
            if (rawSnap.length > 200) {
              const trimmed = rawSnap.slice(-200).join('\n') + '\n';
              require('node:fs').writeFileSync(snapFile, trimmed);
            }
          } catch { /* ignore trim errors */ }
        }
      } catch { /* snapshot non-fatal */ }
      return { ok: true, thresholds, ...agg };
    } catch (e) {
      return { ok: false, error: (e as Error)?.message };
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

  // Processed store stats for UI
  ipcMain.handle('processed.stats', () => {
    try { return jobManager.getProcessedStoreStats(); } catch { return { indexSize: 0, exists: false }; }
  });

  // per-account chroma asset update
  ipcMain.handle('account.setChroma', (_e, platform: Platform, accountId: string, chromaAsset: string) => {
    try {
      const s = getAllSettings();
      const ps = (s.platforms as any)[platform];
      if (ps && Array.isArray(ps.accounts)) {
        const next = ps.accounts.map((a: any) => a.id === accountId ? { ...a, chromaAsset } : a);
        setSettingsPatch({ platforms: { ...s.platforms, [platform]: { ...ps, accounts: next } } as any });
        structuredLog.emit('settings:account-chroma-set', { platform, accountId, chromaAsset });
        return true;
      }
    } catch (e) {
      log.warn('[account.setChroma] failed', (e as Error)?.message || String(e));
    }
    return false;
  });

  ipcMain.handle('set-settings', (_event, settings: Partial<AppSettings>) => {
    const before = getAllSettings();
    setSettingsPatch(settings);
    const after = getAllSettings();
    // 診断ログの再スケジュール
    try { scheduleDiagnostics(); } catch { /* swallow */ }
    // フォルダ監視の再評価
    try {
      const b = before?.watcher || {};
      const a = after?.watcher || {};
      const changed = (
        !!b.enabled !== !!a.enabled ||
        (b.inputDir || '') !== (a.inputDir || '') ||
        (b.glob || '') !== (a.glob || '') ||
        (b.debounceMs || 0) !== (a.debounceMs || 0)
      );
      if (changed) restartFolderWatcher();
    } catch { /* ignore */ }
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
    if (autoPauseState.active) {
      const resumeReason = autoPauseState.reason;
      autoPauseState.active = false;
      autoPauseState.reason = undefined;
      autoPauseState.source = undefined;
      autoPauseState.since = undefined;
      const ts = new Date().toISOString();
      try {
        structuredLog.emit('monitor:manual-resume', { timestamp: ts, reason: resumeReason });
      } catch {
        /* ignore structured log failure */
      }
      broadcastSelfTestEvent({
        result: 'success',
        source: 'manual-resume',
        timestamp: ts,
        failureStreak: 0,
        autoDisabled: false,
        autoDisabledTriggered: false,
        reason: resumeReason,
        autoAction: 'manual-resume',
      });
    }
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

  // 監視ジョブ・バックグラウンド処理を完全停止し、limit件のみ物理生成（隔離テスト）
  ipcMain.handle('jobs.testProcessAllOnce', async (_e, opts?: { platform?: string, accountId?: string, limit?: number }) => {
    const startedAt = Date.now();
    const reqPlatformRaw = opts?.platform?.toLowerCase();
    const useAll = !reqPlatformRaw || reqPlatformRaw === 'all';
    const reqPlatform = useAll ? undefined : (reqPlatformRaw as Platform);
    const reqAccountId = opts?.accountId?.trim();
    const limit = Math.max(1, Math.min(50, Number(opts?.limit) || 5));
    try {
      // 1. 監視ジョブ停止（衝突防止）
      jobManager.stop();
      // 2. 対象アカウント存在チェック（全プラットフォーム or 単一）
      const s = getAllSettings();
      const collectActive = (platformKey: Platform) => {
        const ps = (s.platforms as any)[platformKey];
        if (!ps?.enabled) return [] as string[];
        return (Array.isArray(ps.accounts) ? ps.accounts : [])
          .filter((a: any) => a?.isActive && a.id)
          .map((a: any) => a.id as string);
      };
      let platformAccounts: Record<string,string[]> = {};
      if (useAll) {
        (['x','tiktok','youtube'] as Platform[]).forEach(pf => {
          platformAccounts[pf] = collectActive(pf);
        });
      } else if (reqPlatform) {
        platformAccounts[reqPlatform] = collectActive(reqPlatform);
      }
      // フィルタ（アカウントID指定時）
      if (reqAccountId) {
        for (const k of Object.keys(platformAccounts)) {
          platformAccounts[k] = platformAccounts[k].filter(a => a === reqAccountId);
        }
      }
      const totalActiveAccounts = Object.values(platformAccounts).reduce((a,b)=> a + b.length, 0);
      if (totalActiveAccounts === 0) {
        log.warn(`[jobs.testProcessAllOnce] skip: no-active-accounts useAll=${useAll} platformFilter=${reqPlatform || 'ALL'}`);
        return { ok: false, error: 'テスト実行対象がありません (no-active-accounts)', summary: { totalAccounts: 0, attempted: 0, processed: 0 } } as const;
      }
      // 3. 強制短尺モード (3秒) に一時変更 + testOutputPath があれば一時的に出力先を切替
      process.env.FORCE_RENDER_DURATION = '1';
      const before = s;
      const prevDur = Number(before?.render?.durationSec ?? 15);
      const prevOut = String(before?.general?.outputPath || '');
      try { setSettingsPatch({ render: { ...before.render, durationSec: 3 } as any }); } catch { /* ignore */ }
      try {
        const tOut = String(before?.general?.testOutputPath || '').trim();
        if (tOut) setSettingsPatch({ general: { ...before.general, outputPath: tOut } as any });
      } catch { /* ignore */ }
      // 4. 実行（プラットフォームフィルタ未指定時は全有効プラットフォーム対象）
      const platformsArg = useAll ? undefined : [reqPlatform as Platform];
      const summary = await jobManager.runTestOnceAll({ platforms: platformsArg, accountIds: reqAccountId ? [reqAccountId] : undefined, limit });
      // 5. 設定復元
      try { setSettingsPatch({ render: { ...getAllSettings().render, durationSec: prevDur } as any }); } catch { /* ignore */ }
      try { setSettingsPatch({ general: { ...getAllSettings().general, outputPath: prevOut } as any }); } catch { /* ignore */ }
      delete process.env.FORCE_RENDER_DURATION;
      log.info('[jobs.testProcessAllOnce] summary:', JSON.stringify({ ...summary, elapsedMs: Date.now()-startedAt }));
      return { ok: true, summary } as const;
    } catch (err) {
      delete process.env.FORCE_RENDER_DURATION;
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
  ipcMain.handle('health-status', () => getHealthStatus());
  ipcMain.handle('health.reprobe', async () => {
    const result = await triggerBrowserSelfTest('manual');
    return { ok: result === 'success', result };
  });

  // 最近生成された最終MP4一覧 (メタ + 簡易probe)
  ipcMain.handle('outputs.listRecent', async (_e, opts?: { limit?: number }) => {
    try {
      const s = getAllSettings();
      const limit = Math.max(1, Math.min(50, Number(opts?.limit) || 10));

      // 候補ディレクトリ: outputPath, testOutputPath(優先)
      const outPrimary = (s?.general?.outputPath && s.general.outputPath.trim()) || path.join(process.cwd(), 'output');
      const outTest = (s?.general?.testOutputPath && s.general.testOutputPath.trim()) || '';
      const candidates = new Set<string>();
      if (outTest) candidates.add(outTest);
      if (outPrimary) candidates.add(outPrimary);

      // 収集関数（filterにマッチする動画）。再帰（浅め）+ セーフティリミット
      const collect = async (base: string, recursive = true, filter: RegExp = /-final\.mp4$/i) => {
        const results: Array<{ file: string; path: string; mtimeMs: number; sizeBytes: number; } > = [];
        const maxDirs = 200; const maxFiles = 2000;
        let visitedDirs = 0; let seenFiles = 0;
        const stack: string[] = [base];
        while (stack.length) {
          const dir = stack.pop() as string; visitedDirs++; if (visitedDirs > maxDirs) break;
          let ents: any[] = [];
          try { ents = await fs.readdir(dir, { withFileTypes: true } as any); } catch { continue; }
          for (const ent of ents) {
            try {
              const p = path.join(dir, ent.name);
              if (ent.isDirectory && ent.isDirectory()) {
                if (recursive) stack.push(p);
              } else if (filter.test(ent.name)) {
                const st = await fs.stat(p).catch(()=>null); if (!st) continue;
                results.push({ file: ent.name, path: p, mtimeMs: st.mtimeMs, sizeBytes: st.size });
                seenFiles++; if (seenFiles >= maxFiles) break;
              }
            } catch { /* ignore */ }
          }
          if (seenFiles >= maxFiles) break;
        }
        return results;
      };

      // 候補を走査して集約
      const stats: any[] = [];
      for (const dir of candidates) {
        try { mkdirSync(dir, { recursive: true }); } catch { /* ignore */ }
        if (!existsSyncFS(dir)) continue;
        // 最終成果物のみ列挙: -final.mp4 のみを対象
        const res = await collect(dir, true, /-final\.mp4$/i);
        for (const r of res) stats.push(r);
      }

      stats.sort((a,b)=> b.mtimeMs - a.mtimeMs);
      const top = stats.slice(0, limit);
      const items: any[] = [];
      for (const it of top) {
        let probe: any = null; try { probe = await mediaProbe(it.path).catch(()=>null); } catch { /* ignore */ }
        items.push({
          file: it.file,
          path: it.path,
          sizeBytes: it.sizeBytes,
          mtime: it.mtimeMs,
          width: probe?.width,
          height: probe?.height,
          durationSec: probe?.durationSec,
          hasAudio: probe?.hasAudio,
          hasVideo: probe?.hasVideo,
        });
      }
      return { ok: true, items } as const;
    } catch (err) {
      const e = err as Error; log.error('[outputs.listRecent] failed:', e.message || String(err));
      return { ok: false, error: e.message || String(err) } as const;
    }
  });

  // 指定ファイルをエクスプローラで表示
  ipcMain.handle('outputs.reveal', async (_e, filePath: string) => {
    try {
      if (filePath && existsSyncFS(filePath)) {
        try { (await import('electron')).shell.showItemInFolder(filePath); } catch { /* ignore */ }
        return true;
      }
      return false;
    } catch { return false; }
  });

  // Render test generate: URL/ローカルパスから合成を実行（プラットフォーム自動判定 + DL対応）
  ipcMain.handle('render.testGenerate', async (_e, filePath: string) => {
    try {
      const s = getAllSettings();
      // testOutputPath があれば一時的に差し替え
      const settings: AppSettings = JSON.parse(JSON.stringify(s));
      if (s.general.testOutputPath) settings.general.outputPath = s.general.testOutputPath;
      // プラットフォーム推定とDL
      let sourceArg = filePath;
      const isUrl = typeof filePath === 'string' && /^https?:\/\//i.test(filePath);
      const inferPlatform = (u: string): Platform => {
        if (/tiktok\.com\//i.test(u)) return 'tiktok';
        if (/youtube\.com\//i.test(u) || /youtu\.be\//i.test(u)) return 'youtube';
        if (/x\.com\//i.test(u) || /twitter\.com\//i.test(u)) return 'x';
        return 'x';
      };
      let platform: Platform = 'x';
      if (isUrl) {
        platform = inferPlatform(filePath);
        try {
          const dl = await downloadVideoToTemp(filePath, platform);
          if (dl && dl.filepath) sourceArg = dl.filepath;
        } catch (e) {
          log.error('[render.testGenerate] downloadVideoToTemp failed:', (e as Error)?.message || String(e));
          // URLソースでDL失敗は致命。エラーを投げる（GUIに表示）
          throw new Error(`ダウンロード失敗 (${platform}): ${(e as Error)?.message || String(e)}`);
        }
      } else {
        // ローカルパスの場合はそのまま使用
        platform = ((): Platform => {
          // 設定のプラットフォームタブで表示中の既定を使う余地もあるが、ここではXにフォールバック
          const pf = (s as any)?.general?.defaultPlatform as Platform | undefined;
          return (pf === 'x' || pf === 'tiktok' || pf === 'youtube') ? pf : 'x';
        })();
      }
      // finalizeMedia 実行
      const out = await finalizeMedia({
        platform,
        account: null,
        inputPath: sourceArg,
        outputDir: settings.general.outputPath || process.cwd(),
        settings,
        forceDurationSec: settings.render?.durationSec && settings.render.durationSec < 60 ? settings.render.durationSec : undefined,
      });
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

  // 1秒プレビュー版（durationを強制1秒に）
  ipcMain.handle('render.previewGenerate', async (_e, filePath: string) => {
    try {
      const s = getAllSettings();
      const settings: AppSettings = JSON.parse(JSON.stringify(s));
      if (s.general.testOutputPath) settings.general.outputPath = s.general.testOutputPath;
      // プラットフォーム推定とDL（上と同様）
      let sourceArg = filePath;
      const isUrl = typeof filePath === 'string' && /^https?:\/\//i.test(filePath);
      const inferPlatform = (u: string): Platform => {
        if (/tiktok\.com\//i.test(u)) return 'tiktok';
        if (/youtube\.com\//i.test(u) || /youtu\.be\//i.test(u)) return 'youtube';
        if (/x\.com\//i.test(u) || /twitter\.com\//i.test(u)) return 'x';
        return 'x';
      };
      let platform: Platform = 'x';
      if (isUrl) {
        platform = inferPlatform(filePath);
        const dl = await downloadVideoToTemp(filePath, platform);
        if (dl && dl.filepath) sourceArg = dl.filepath; else throw new Error('プレビュー用のDL失敗');
      }
      const out = await finalizeMedia({
        platform,
        account: null,
        inputPath: sourceArg,
        outputDir: settings.general.outputPath || process.cwd(),
        settings: { ...settings, render: { ...settings.render, durationSec: 1 } },
        forceDurationSec: 1,
      });
      return out;
    } catch (e) {
      log.error('[render.previewGenerate] failed:', (e as Error)?.message || String(e));
      throw e;
    }
  });

  // NOTE: previously a Python-based Geturl helper was used here. We now prefer the Node downloader

  // 旧プレビューIPCは廃止

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

  // E2E Test handlers
  ipcMain.handle('e2e.captureSingleXVideo', async (_event, opts: { url: string; outputDir: string; debugFile?: string }) => {
    try {
      const { captureSingleXVideo } = await import('./tasks/capture-x-single.js');
      const captureOpts = {
        tweetUrl: opts.url,
        outDir: opts.outputDir,
        debugFile: opts.debugFile || 'e2e-capture-debug.jsonl',
        timeoutMs: 45000,
        preferChromeStable: ((store as unknown as { store: AppSettings }).store?.general?.enforceChromeStable) !== false,
      };
      const result = await captureSingleXVideo(captureOpts);
      log.info('[e2e.captureSingleXVideo] result:', result);
      return result;
    } catch (error) {
      const e = error as Error;
      log.error('[e2e.captureSingleXVideo] failed:', e.message || String(error));
      throw error;
    }
  });

  ipcMain.handle('e2e.runTestLatestNAll', async (_event, settings: any) => {
    try {
      log.info('[e2e.runTestLatestNAll] starting with settings:', JSON.stringify(settings, null, 2));
      
      // Update store with test settings
      setSettingsPatch(settings);
      
      // Run the job manager test
      const result = await jobManager.runTestLatestNAll();
      log.info('[e2e.runTestLatestNAll] completed:', result);
      return result;
    } catch (error) {
      const e = error as Error;
      log.error('[e2e.runTestLatestNAll] failed:', e.message || String(error));
      throw error;
    }
  });
}

const createWindow = async () => {
  // TODO (tab-capture): Playwright で launchPersistentContext({ args: ['--disable-extensions-except=...','--load-extension=...'] }) を行う専用 capture manager を後段追加。
  // Create the browser window.
  const preloadPath = path.join(__dirname, 'preload.cjs');
  log.info('[main] resolved preload path:', preloadPath);
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    backgroundColor: '#111111',
  title: 'ShortVideo-Genius',
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
  // file:// での ESModules/CSS 読み込み時の CORS/同一生成制約を緩和
  webSecurity: false,
  allowRunningInsecureContent: true,
    },
  });

  // 可能な限り早く可視化して存在を示す（ロード完了を待たない）
  try {
    mainWindow.setTitle('ShortVideo-Genius');
    mainWindow.center();
    mainWindow.show();
    mainWindow.focus();
    log.info('[main] window created and show() requested');
  } catch { /* ignore */ }

  // Ensure we track window lifecycle to avoid using a destroyed object
  try {
    mainWindow.on('closed', () => {
      try { log.info('[lifecycle] mainWindow closed'); } catch { /* ignore */ }
      try { mainWindow = null; } catch { /* ignore */ }
    });
  } catch { /* ignore */ }

  // and load the index.html of the app.
  // Prefer packaged renderer when app.isPackaged, otherwise use dev server.
  const devPort = Number(process.env.DEV_SERVER_PORT || 5173);
  const devServerURL = `http://127.0.0.1:${devPort}`;
  const rendererIndex = path.join(__dirname, '../../renderer/index.html');
  const forcePackaged = process.env.ELECTRON_FORCE_PACKAGED === '1';
  // 一部配布環境で NODE_ENV=production でも devServer を試みる誤動作を抑止
  const isDefinitelyPackaged = app.isPackaged || forcePackaged;
  const useDevServer = (process.env.NODE_ENV === 'development' && !isDefinitelyPackaged) && !forcePackaged;

  // Helper to safely check window availability
  const alive = () => !!(mainWindow && !mainWindow.isDestroyed());

  // Diagnostics: forward renderer console and load events to main log (register BEFORE load)
  let didFinishLoad = false;
  let showFallbackTimer: NodeJS.Timeout | null = null;
  try {
    mainWindow.webContents.on('console-message', (_e, level, message, line, sourceId) => {
      const lvl = typeof level === 'number' ? level : 0;
      const prefix = `[renderer:console L${lvl}]`;
      try { log.info(prefix, message, `(${sourceId}:${line})`); } catch { /* ignore */ }
    });
    mainWindow.webContents.on('did-finish-load', () => {
      try { log.info('[renderer] did-finish-load'); } catch { /* ignore */ }
      didFinishLoad = true;
      if (showFallbackTimer) { try { clearTimeout(showFallbackTimer); } catch { /* ignore */ } showFallbackTimer = null; }
      try {
        // Ensure window is visible and focused when load completes
        if (alive()) {
          try { mainWindow.setTitle('ShortVideo-Genius'); } catch {}
          if (mainWindow && !mainWindow.isVisible()) mainWindow.show();
        }
        if (alive()) { mainWindow!.focus(); }
        try { flushPendingSelfTestEvents(); } catch { /* ignore */ }
      } catch { /* ignore */ }
    });
    mainWindow.webContents.on('did-fail-load', async (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      try {
        log.error('[renderer] did-fail-load', { errorCode, errorDescription, isMainFrame, validatedURL });
        // If dev server failed (e.g., ERR_CONNECTION_REFUSED), fallback to local file once.
        const isConnRefused = errorCode === -102 /* ERR_CONNECTION_REFUSED */ || /CONNECTION_REFUSED/i.test(String(errorDescription || ''));
  const triedDev = typeof validatedURL === 'string' && /http:\/\/127\.0\.0\.1:\d+/.test(validatedURL);
        if (alive() && (isConnRefused || triedDev)) {
          log.info('[main] falling back to packaged renderer:', rendererIndex);
          try { await mainWindow!.loadFile(rendererIndex); } catch { /* ignore */ }
        }
      } catch { /* ignore */ }
    });
    mainWindow.webContents.on('render-process-gone', (_event, details) => {
      try { log.error('[renderer] render-process-gone', details?.reason || 'unknown'); } catch { /* ignore */ }
    });
  } catch { /* ignore */ }

  try {
    if (useDevServer) {
      log.info('[main] loading dev server:', devServerURL);
      const maxAttempts = Math.max(1, Number(process.env.ELECTRON_DEVSERVER_MAX_RETRIES || '3'));
      const retryDelayMs = Math.max(0, Number(process.env.ELECTRON_DEVSERVER_RETRY_DELAY_MS || '1000'));
      let attempt = 0;
      let loaded = false;
      while (alive() && attempt < maxAttempts && !loaded) {
        attempt += 1;
        try {
          if (!alive()) break;
          await mainWindow!.loadURL(devServerURL);
          loaded = true;
        } catch (err) {
          log.warn('[main] dev server load attempt failed', {
            attempt,
            maxAttempts,
            message: (err as Error)?.message || String(err),
          });
          if (!alive()) break;
          if (attempt < maxAttempts && retryDelayMs > 0) {
            try { await new Promise((resolve) => setTimeout(resolve, retryDelayMs)); } catch { /* ignore */ }
          }
        }
      }
      if (!loaded && alive()) {
        log.warn('[main] dev server load failed after retries, falling back to packaged renderer:', rendererIndex);
        await mainWindow!.loadFile(rendererIndex);
      }
    } else {
      log.info('[main] loading renderer file:', rendererIndex);
      if (alive()) { await mainWindow!.loadFile(rendererIndex); }
    }
  } catch (e) {
    // Fallback to file on any error
    log.warn('[main] primary load failed, fallback to file:', (e as Error)?.message || String(e));
    try { if (alive()) { await mainWindow!.loadFile(rendererIndex); } } catch { /* ignore */ }
  }

  // ロードが長い/失敗で白画面・非表示に見える場合の保険: 数秒後に再度 show/focus を試みる
  try {
    showFallbackTimer = setTimeout(() => {
      try {
        if (!alive()) return;
        if (mainWindow && !mainWindow.isVisible()) {
          log.info('[main] show fallback timer: window not visible, calling show()');
          try { mainWindow!.show(); } catch { /* ignore */ }
        }
        try { mainWindow!.focus(); } catch { /* ignore */ }
        // まだ did-finish-load していないなら、file を明示ロード（念のため一回）
        if (!didFinishLoad) {
          log.info('[main] show fallback timer: did-finish-load not observed, reloading packaged renderer');
          try { if (alive()) { mainWindow!.loadFile(rendererIndex); } } catch { /* ignore */ }
        }
      } catch { /* ignore */ }
    }, 4000);
  } catch { /* ignore */ }

  // Open the DevTools.
  if (process.env.NODE_ENV === 'development' || process.env.ELECTRON_OPEN_DEVTOOLS === '1') {
    mainWindow.webContents.openDevTools();
  }

  // Show when ready to avoid flicker and ensure visibility
  try {
    mainWindow.once('ready-to-show', () => {
      try {
        if (alive()) {
          try { mainWindow.setTitle('ShortVideo-Genius'); } catch {}
          if (mainWindow && !mainWindow.isVisible()) mainWindow.show();
        }
      } catch { /* ignore */ }
    });
  } catch { /* ignore */ }
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
  // Kick off startup media health probe (non-blocking). Renderer can query via health-status IPC.
  try { void runStartupMediaProbe(); } catch { /* ignore */ }
  try { startBrowserSelfTestScheduler(); } catch { /* ignore */ }
  try { void triggerBrowserSelfTest('startup'); } catch { /* ignore */ }
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
  // Portability: ensure general.outputPath is usable. In development, avoid auto-overwrite to prevent "settings not preserved" surprises.
  try {
    const s: AppSettings = (store as unknown as { store: AppSettings }).store;
    const isDev = (process.env.NODE_ENV === 'development' || !app.isPackaged);
    const portabilityDisabled = process.env.PORTABILITY_DISABLE === '1';
    const forceFallback = process.env.PORTABILITY_FORCE_FALLBACK === '1';
    if (portabilityDisabled) {
      log.info('[portability] disabled by env PORTABILITY_DISABLE=1');
    } else {
      const ensureWritable = async (p: string) => {
        const testFile = path.join(p, '.writetest');
        try {
          await fs.mkdir(p, { recursive: true }).catch(()=>{});
          await fs.writeFile(testFile, '1');
          await fs.unlink(testFile).catch(()=>{});
          return { ok: true } as const;
        } catch (err) {
          const e = err as Error;
          return { ok: false, error: e?.message || String(err) } as const;
        }
      };
      const prevOut = s?.general?.outputPath || '';
      let out = prevOut;
      if (!out) {
        try { out = path.join(app.getPath('videos'), 'ShortVideo-Genius-Output'); } catch { out = path.join(app.getPath('userData'), 'output'); }
      }
      const w = await ensureWritable(out);
      if (!w.ok) {
        const fallback = path.join(app.getPath('userData'), 'output');
        const wf = await ensureWritable(fallback);
        // In development, do NOT overwrite existing non-empty user setting on failure unless explicitly forced.
        if (isDev && prevOut && !forceFallback) {
          log.warn('[portability] outputPath not writable in dev; keeping user setting. path=', out, 'error=', w.error);
        } else if (wf.ok) {
          if (out !== fallback) {
            (store as unknown as { set: (k: string, v: unknown) => void }).set('general.outputPath', fallback);
            log.info('[portability] outputPath fallback applied:', { from: out, to: fallback, reason: w.error, dev: isDev, forced: forceFallback });
          }
        } else {
          log.warn('[portability] both primary and fallback output paths failed write test', { primary: { path: out, error: w.error }, fallback: { path: fallback, error: wf.ok ? null : 'not-writable' } });
        }
      } else {
        if (!prevOut) {
          (store as unknown as { set: (k: string, v: unknown) => void }).set('general.outputPath', out);
          log.info('[portability] outputPath configured:', out);
        } else if (prevOut !== out) {
          // Rare case: computed default differs from prevOut (should not happen); keep prev in dev
          if (isDev && !forceFallback) {
            log.info('[portability] keeping existing user outputPath in dev:', prevOut);
          } else {
            (store as unknown as { set: (k: string, v: unknown) => void }).set('general.outputPath', out);
            log.info('[portability] outputPath adjusted:', { from: prevOut, to: out });
          }
        } else {
          // ok and unchanged
          log.info('[portability] outputPath verified writable:', out);
        }
      }
    }
  } catch (e) { log.warn('[portability] init failed:', (e as Error)?.message || String(e)); }
  const forceUi = process.env.CAPTURE_SHOW_UI === '1';
  if (!headlessCapture || forceUi) {
    await createWindow();
  } else {
    log.info('[main] Headless capture mode enabled (CAPTURE_X_SCREENSHOTS=1). Skipping renderer window.');
  }
  setupIpcHandlers();
  try { scheduleDiagnostics(); } catch { /* ignore */ }
  try { restartFolderWatcher(); } catch { /* ignore */ }

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
      const limit = Math.max(1, Math.min(50, Number(process.env.CAPTURE_X_LIMIT || capLimitCli) || 5));
      if (!account) {
        log.error('[auto-capture] Missing CAPTURE_X_ACCOUNT. Aborting.');
        return;
      }
      // Base dir: CAPTURE_OUT_BASE (abs or relative to CWD) or fallback to getScreenshotRoot()
      const capBaseRaw = (process.env.CAPTURE_OUT_BASE || getArg('capture-out') || '').trim();
      let baseDir = '';
      if (capBaseRaw) {
        try { baseDir = path.isAbsolute(capBaseRaw) ? capBaseRaw : path.join(process.cwd(), capBaseRaw); } catch { /* ignore */ }
      }
      if (!baseDir) baseDir = getScreenshotRoot();
      // outDir for CLI is the parent of account dir: <base>/out/screenshots
      const outDir = path.join(baseDir, 'out', 'screenshots');
      try { mkdirSync(outDir, { recursive: true }); } catch { /* ignore */ }
      log.info('[auto-capture] Start:', { account, limit, outDir });

      // Prefer CLI runner always (packaged/dev). It writes into <outDir>/<account>
      try {
        const runner = path.join(app.getAppPath(), 'screenshot', 'bin', 'grab.cjs');
        const env = { ...process.env, ELECTRON_RUN_AS_NODE: '1' } as NodeJS.ProcessEnv;
        const browsersDir = await resolvePlaywrightBrowsersDir();
        if (browsersDir) env.PLAYWRIGHT_BROWSERS_PATH = browsersDir;
        await new Promise<void>((resolve) => {
          const child = spawn(process.execPath, [runner, '--user', account, '--count', String(limit), '--outDir', outDir], {
            cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'], shell: false, env,
          });
          child.stdout.on('data', (d) => { try { log.info('[screenshot-cli]', String(d).trim()); } catch {} });
          child.stderr.on('data', (d) => { try { log.warn('[screenshot-cli]', String(d).trim()); } catch {} });
          child.on('close', () => resolve());
          child.on('error', () => resolve());
        });
      } catch (e) {
        log.warn('[auto-capture] CLI run failed:', (e as Error)?.message || String(e));
      }

      // Save summary and JSONL into <outDir>/<account>
      try {
        const acctSan = account.startsWith('@') ? account.substring(1) : account;
        const acctDir = path.join(outDir, acctSan);
        const files = await fs.readdir(acctDir).catch(() => [] as string[]);
        const mp4s = files.filter(f => f.toLowerCase().endsWith('.mp4')).sort();
        const pngs = files.filter(f => f.toLowerCase().endsWith('.png')).sort();
        const summary: Array<{ id: string; src: string; saved: string; note?: string }> = [];
        let idx = 0;
        // Prefer mp4 candidates with duration > 5s when possible. Load basic stat/duration heuristics.
        const ffprobe = async (filePath: string) => {
          try {
            const { spawn } = require('child_process');
            const ff = (function resolve() { try { return require('ffmpeg-static') || ''; } catch { return ''; } })();
            if (!ff) return null;
            return await new Promise((res) => {
              const cp = spawn(ff, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', filePath], { stdio: ['ignore', 'pipe', 'pipe'] });
              let out = '';
              cp.stdout.on('data', (d) => { out += String(d || ''); });
              cp.on('close', () => { res(out ? Number(out.trim()) : null); });
              cp.on('error', () => res(null));
            });
          } catch { return null; }
        };
        // gather candidate mp4s with durations
        const candidates = [] as Array<{ name: string; full: string; dur: number | null; size: number | null }>;
        for (const f of mp4s) {
          const full = path.join(acctDir, f);
          let dur = null; let size = null;
          try { const st = await fs.stat(full).catch(()=>null); if (st) size = st.size; } catch {}
          try { dur = await ffprobe(full); } catch {}
          candidates.push({ name: f, full, dur: (typeof dur === 'number' && !Number.isNaN(dur)) ? dur : null, size });
        }
        // Prefer mp4s with dur >=5s; fallback to largest size
        let chosenMp4 = null;
        const longOnes = candidates.filter(c => c.dur && c.dur >= 5);
        if (longOnes.length) {
          longOnes.sort((a,b)=> (b.dur! - a.dur!) || ((b.size||0) - (a.size||0)));
          chosenMp4 = longOnes[0];
        } else if (candidates.length) {
          candidates.sort((a,b)=> (b.size||0) - (a.size||0));
          chosenMp4 = candidates[0];
        }
        for (const f of mp4s) { idx += 1; const full = path.join(acctDir, f); const note = (chosenMp4 && chosenMp4.full === full) ? 'chosen' : undefined; summary.push({ id: String(idx), src: full, saved: full, note }); }
        for (const f of pngs) { idx += 1; summary.push({ id: String(idx), src: path.join(acctDir, f), saved: path.join(acctDir, f) }); }
        // If we picked a chosenMp4, also log rationale
        try {
          if (chosenMp4) {
            const msg = `[auto-capture] selected mp4: ${chosenMp4.full} dur=${chosenMp4.dur} size=${chosenMp4.size}`;
            log.info(msg);
            console.info(msg);
          }
        } catch {}
        await fs.writeFile(path.join(acctDir, 'summary.json'), JSON.stringify(summary, null, 2), 'utf8').catch(()=>{});
        await ensureJsonlPath();
        if (jsonlPath) {
          const buf = await fs.readFile(jsonlPath);
          await fs.writeFile(path.join(acctDir, 'app.log.jsonl'), buf).catch(()=>{});
        }
        log.info(`[auto-capture] Done. Saved ${summary.length} file(s) to ${acctDir}`);
        console.info(`[auto-capture] Done. Saved ${summary.length} file(s) to ${acctDir}`);
      } catch { /* ignore */ }

      const shouldExit = (process.env.CAPTURE_EXIT === '1') || (getArg('capture-exit') !== null);
      if (shouldExit) {
  try { safeAutoExit(0); } catch { /* ignore */ }
      }
    })();
  } catch { /* ignore */ }

  // Optional: Run a one-off test across all accounts on start and save logs into workspace for inspection
  try {
  const runTestOnStart = process.env.RUN_TEST_ON_START === '1' && process.env.CAPTURE_X_SCREENSHOTS !== '1';
    if (runTestOnStart) {
      // 明示的に新規キャプチャを強制（既存PNG除外）
      if (!process.env.FORCE_FRESH_X) process.env.FORCE_FRESH_X = '1';
      log.info('[auto-run] FORCED FORCE_FRESH_X=1 for test run');
      const ts = Date.now();
      // Save under workspace root if available, else under userData
      let outDir = path.join(process.cwd(), 'test-results', `auto-run-${ts}`);
      try { mkdirSync(outDir, { recursive: true }); } catch { /* ignore */ }
      // Fallback if mkdir failed (e.g., CWD not writable)
      if (!existsSyncFS(outDir)) {
        outDir = path.join(app.getPath('userData'), 'test-results', `auto-run-${ts}`);
        try { mkdirSync(outDir, { recursive: true }); } catch { /* ignore */ }
      }
      // 事前にプレースホルダー summary.json を作成（異常終了でも存在を保証）
      try {
        await fs.writeFile(path.join(outDir, 'summary.json'), JSON.stringify({ ok: null, status: 'pending', startedAt: ts }, null, 2), 'utf8').catch(()=>{});
      } catch { /* ignore */ }
      // --- フェイルセーフ: 異常終了時にも summary.json を残すためのハンドラ登録 ---
      let autorunFinished = false;
      const writeAbortSummary = async (reason: string) => {
        try {
          await fs.writeFile(path.join(outDir, 'summary.json'), JSON.stringify({ ok: false, aborted: true, reason }, null, 2), 'utf8').catch(()=>{});
          await ensureJsonlPath();
          if (jsonlPath) {
            const buf = await fs.readFile(jsonlPath);
            await fs.writeFile(path.join(outDir, 'app.log.jsonl'), buf).catch(()=>{});
          }
        } catch { /* ignore */ }
      };
      (function attachAbortHooksOnce(){
        try {
          const guard = (r: string) => { if (!autorunFinished) { try { writeAbortSummary(r); } catch {} } };
          process.on('SIGINT', () => guard('SIGINT'));
          process.on('SIGTERM', () => guard('SIGTERM'));
          process.on('exit', (code) => guard(`exit:${code}`));
          process.on('uncaughtException', (err) => guard(`uncaught:${(err as Error)?.message || String(err)}`));
          try { app.on('will-quit', () => guard('will-quit')); } catch { /* ignore */ }
        } catch { /* ignore */ }
      })();
      // 詳細イベントログ（process-start / process-done など）を events.log に書き出すための環境変数
      try {
        // 既にユーザー/起動スクリプト側で TEST_DEBUG_FILE が設定されている場合は尊重し上書きしない
        if (!process.env.TEST_DEBUG_FILE || process.env.TEST_DEBUG_FILE.trim() === '') {
          process.env.TEST_DEBUG_FILE = path.join(outDir, 'events.log');
          log.info('[auto-run] TEST_DEBUG_FILE set to', process.env.TEST_DEBUG_FILE);
        } else {
          log.info('[auto-run] preserve existing TEST_DEBUG_FILE=', process.env.TEST_DEBUG_FILE);
        }
      } catch { /* ignore */ }

      // Seed: テスト用アカウント/設定を自動投入（フェーズ2仕様）
      try {
        const s = getAllSettings();
        const next = JSON.parse(JSON.stringify(s)) as AppSettings;
        // 有効化 & 監視対象アカウント（各1アカウント）を投入
        const fast = process.env.RUN_TEST_FAST === '1';
        // X は常に 1 アカウントシード（kandounekodougaを優先）
        next.platforms.x = {
          enabled: true,
          intervalMinutes: s.platforms.x?.intervalMinutes ?? 15,
          scrapeDelayMs: s.platforms.x?.scrapeDelayMs ?? 5000,
          accounts: [
            { id: 'kandounekodouga', isActive: true, backfillRemaining: 0, processedIds: [], lastCursor: '' },
            { id: 'Mountain_cb', isActive: true, backfillRemaining: 0, processedIds: [], lastCursor: '' },
          ],
          chroma: { enabled: true, mode: 'fixed' },
        } as any;
        if (!fast) {
          next.platforms.tiktok = {
            enabled: true,
            intervalMinutes: s.platforms.tiktok?.intervalMinutes ?? 15,
            scrapeDelayMs: s.platforms.tiktok?.scrapeDelayMs ?? 5000,
            accounts: [
              { id: 'sonnawakenai.ai', isActive: true, backfillRemaining: 0, processedIds: [], lastCursor: '' },
            ],
            chroma: { enabled: true, mode: 'fixed' },
          } as any;
          next.platforms.youtube = {
            enabled: true,
            intervalMinutes: s.platforms.youtube?.intervalMinutes ?? 15,
            scrapeDelayMs: s.platforms.youtube?.scrapeDelayMs ?? 5000,
            accounts: [
              { id: 'BMYuya', isActive: true, backfillRemaining: 0, processedIds: [], lastCursor: '' },
            ],
            chroma: { enabled: true, mode: 'fixed' },
          } as any;
        } else {
          // 高速モードでは TikTok / YouTube を明示的に無効化
          next.platforms.tiktok = { enabled: false, accounts: [], chroma: { enabled: false, mode: 'fixed' } } as any;
          next.platforms.youtube = { enabled: false, accounts: [], chroma: { enabled: false, mode: 'fixed' } } as any;
          log.info('[auto-run] RUN_TEST_FAST=1 -> X のみシード');
        }
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
            // フォールバック: ルートの haikei.mp4 を背景に使用
            const fallbackBg = path.join(process.cwd(), 'haikei.mp4');
            if (existsSyncFS(fallbackBg)) {
              next.render.backgroundVideoPath = fallbackBg;
              log.info('[auto-run] Fallback backgroundVideoPath:', fallbackBg);
            } else {
              log.warn('[auto-run] background video not found at', bgCandidate, 'and fallback haikei.mp4 not found at', fallbackBg, '- X screenshot overlay may fail without a background video.');
            }
          }
        } catch { /* ignore */ }
  setSettingsPatch(next as Partial<AppSettings>);
  log.info('[auto-run] Seeded test accounts and forced duration=3s. Output:', outDir);
  try { require('fs').appendFileSync(path.join(outDir, 'debug.log'), JSON.stringify({ t: new Date().toISOString(), stage: 'seeded-settings' })+'\n'); } catch {}
      } catch (e) {
        log.warn('[auto-run] seeding test accounts failed:', (e as Error)?.message || String(e));
  try { require('fs').appendFileSync(path.join(outDir, 'debug.log'), JSON.stringify({ t: new Date().toISOString(), stage: 'seed-settings-error', msg: (e as Error)?.message })+'\n'); } catch {}
      }

  // 自動テスト実行時も短尺を強制
  process.env.FORCE_RENDER_DURATION = '1';
  try { require('fs').appendFileSync(path.join(outDir, 'debug.log'), JSON.stringify({ t: new Date().toISOString(), stage: 'before-runTestOnceAll' })+'\n'); } catch {}
  log.info('[auto-run] invoking runTestOnceAll ...');

  const targetUrls = process.env.TEST_TARGET_URLS;
  if (targetUrls) {
    const urls = targetUrls.split(',').map(u => u.trim()).filter(Boolean);
    log.info(`[auto-run] Starting test run for specific URLs: ${urls.join(', ')}`);
    const promises = urls.map(url => jobManager.processSingleUrl(url, { isTest: true, outputDir: outDir }));
    Promise.all(promises)
      .then(async (results) => {
        log.info('[auto-run] specific URL test finished. results:', results.length);
        try {
          await fs.writeFile(path.join(outDir, 'summary.json'), JSON.stringify({ type: 'url-test', results }, null, 2), 'utf8');
          autorunFinished = true;
          if (process.env.RUN_TEST_EXIT === '1') safeAutoExit(0);
        } catch {}
      })
      .catch(e => {
        const msg = (e as Error)?.message || String(e);
        log.error('[auto-run] specific URL test failed:', msg);
        try { fs.writeFile(path.join(outDir, 'summary.json'), JSON.stringify({ type: 'url-test', ok: false, error: msg }, null, 2), 'utf8').catch(()=>{}); } catch {}
        try { autorunFinished = true; } catch {}
        if (process.env.RUN_TEST_EXIT === '1') safeAutoExit(1);
      });
  } else {
    jobManager.runTestOnceAll()
        .then(async (summary) => {
          try { require('fs').appendFileSync(path.join(outDir, 'debug.log'), JSON.stringify({ t: new Date().toISOString(), stage: 'test-finished', summary })+'\n'); } catch {}
          try {
            await fs.writeFile(path.join(outDir, 'summary.json'), JSON.stringify(summary, null, 2), 'utf8');
          } catch { /* ignore */ }
          try {
            await ensureJsonlPath();
            if (jsonlPath) {
              const buf = await fs.readFile(jsonlPath);
              await fs.writeFile(path.join(outDir, 'app.log.jsonl'), buf);
              try { require('fs').appendFileSync(path.join(outDir, 'debug.log'), JSON.stringify({ t: new Date().toISOString(), stage: 'copied-jsonl' })+'\n'); } catch {}
            }
          } catch { /* ignore */ }
          log.info('[auto-run] testProcessAllOnce summary saved to:', outDir);
          // 片付け
          try { delete process.env.FORCE_RENDER_DURATION; } catch { /* ignore */ }
          try { require('fs').appendFileSync(path.join(outDir, 'debug.log'), JSON.stringify({ t: new Date().toISOString(), stage: 'cleanup-done' })+'\n'); } catch {}
          try { autorunFinished = true; } catch {}
          // オプション: 自動終了（NO_AUTO_EXIT=1 なら抑止）
          try {
            if (process.env.RUN_TEST_EXIT === '1') {
              if (process.env.NO_AUTO_EXIT === '1') {
                log.info('[auto-run] RUN_TEST_EXIT=1 だが NO_AUTO_EXIT=1 のため exit 抑止');
              } else {
                log.info('[auto-run] RUN_TEST_EXIT=1 set. Exiting app...');
                safeAutoExit(0);
              }
            }
          } catch { /* ignore */ }
        })
        .catch(async (e) => {
          const err = e as Error;
          log.error('[auto-run] testProcessAllOnce failed:', err.message || String(e));
          try { require('fs').appendFileSync(path.join(outDir, 'debug.log'), JSON.stringify({ t: new Date().toISOString(), stage: 'test-error', msg: err.message })+'\n'); } catch {}
          // 失敗時も summary.json と app.log.jsonl を出力してデバッグ容易化
          try {
            await fs.writeFile(path.join(outDir, 'summary.json'), JSON.stringify({ ok: false, error: err.message || String(e) }, null, 2), 'utf8');
          } catch { /* ignore */ }
          try {
            await ensureJsonlPath();
            if (jsonlPath) {
              const buf = await fs.readFile(jsonlPath);
              await fs.writeFile(path.join(outDir, 'app.log.jsonl'), buf).catch(()=>{});
            }
          } catch { /* ignore */ }
          // 片付け
          try { delete process.env.FORCE_RENDER_DURATION; } catch { /* ignore */ }
          try { require('fs').appendFileSync(path.join(outDir, 'debug.log'), JSON.stringify({ t: new Date().toISOString(), stage: 'cleanup-after-error' })+'\n'); } catch {}
          try { autorunFinished = true; } catch {}
          // オプション: 自動終了（失敗コード / NO_AUTO_EXIT=1 で抑止）
          try {
            if (process.env.RUN_TEST_EXIT === '1') {
              if (process.env.NO_AUTO_EXIT === '1') {
                log.info('[auto-run] RUN_TEST_EXIT=1 失敗時だが NO_AUTO_EXIT=1 のため exit 抑止');
              } else {
                log.info('[auto-run] RUN_TEST_EXIT=1 set. Exiting app with code 1...');
                safeAutoExit(1);
              }
            }
          } catch { /* ignore */ }
        });
  }
    }
  } catch {
    /* ignore */
}

  // === Chrome Stable 再生ヘルスチェック ===
  try {
    const s = getAllSettings();
    const needCheck = !!s?.general?.playbackHealthCheckOnStart;
    if (needCheck) {
      log.info('[health] starting playback health check');
      // 動作確認用の最小 MP4 (H264+AAC) データURL を生成（1秒無音黒映像）
      const samplePath = path.join(app.getPath('userData'), 'health-sample.mp4');
      try {
        if (!existsSyncFS(samplePath)) {
          const ff = (function resolve() { try { return require('ffmpeg-static') || ''; } catch { return ''; } })();
          if (ff) {
            const { spawn } = require('child_process');
            await new Promise<void>((resolve, reject) => {
              const cp = spawn(ff, ['-f','lavfi','-i','color=c=black:s=320x240:d=1','-f','lavfi','-i','anullsrc=channel_layout=stereo:sample_rate=44100','-shortest','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac','-y', samplePath], { stdio: ['ignore','ignore','pipe'] });
              cp.on('close', (code:number)=> code===0?resolve():reject(new Error('ffmpeg exit '+code)));
              cp.on('error', reject);
            }).catch(e=> log.warn('[health] ffmpeg sample gen failed:', (e as Error)?.message || String(e)));
          }
        }
      } catch { /* ignore */ }
      const { chromium } = require('playwright');
      try {
        const launchArgs = ['--autoplay-policy=no-user-gesture-required','--ignore-gpu-blocklist'];
        if (s?.general?.enforceChromeStable) {
          // attempt to detect chrome stable via PLAYWRIGHT_CHROMIUM_PATH or typical install paths (best-effort)
          // fallback: use bundled chromium
          try {
            const chromeCandidates: string[] = [];
            if (process.platform === 'win32') chromeCandidates.push('C:/Program Files/Google/Chrome/Application/chrome.exe');
            const chromePath = chromeCandidates.find(p => require('node:fs').existsSync(p));
            if (chromePath) launchArgs.push(`--browser=${chromePath}`); // note: not a real arg for playwright, placeholder log
            log.info('[health] enforceChromeStable candidates checked, found?', !!chromePath);
          } catch {/* ignore */}
        }
        const ctx = await chromium.launch({ headless: true, args: launchArgs });
        const page = await ctx.newPage();
        let ok = false; let errMsg = '';
        try {
          await page.goto('about:blank');
          const f = samplePath && existsSyncFS(samplePath) ? samplePath : null;
          if (f) {
            const rel = f.replace(/\\/g,'/');
            await page.setContent(`<html><body><video id=v src="file://${rel}" autoplay></video></body></html>`);
            await page.waitForTimeout(800);
            const state = await page.evaluate(() => { const v:any = document.getElementById('v'); return v ? { ready:v.readyState, dur:v.duration, err: !!v.error } : null; });
            if (state && state.ready >= 2 && !state.err && state.dur >= 0.9) ok = true; else errMsg = JSON.stringify(state);
          } else {
            errMsg = 'sample-mp4-missing';
          }
        } catch (e) { errMsg = (e as Error)?.message || String(e); }
        await ctx.close();
        if (ok) log.info('[health] playback check: OK'); else log.warn('[health] playback check: FAIL ->', errMsg);
      } catch (e) {
        log.warn('[health] playback check launch failed:', (e as Error)?.message || String(e));
      }
    }
  } catch (e) { log.warn('[health] init failed:', (e as Error)?.message || String(e)); }

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

// 旧自動プレビュー機能は廃止
});

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  try { globalShortcut.unregisterAll(); } catch { /* ignore */ }
  try { pushExitTrace({ phase: 'window-all-closed' }); } catch { /* ignore */ }
  if (process.platform !== 'darwin') {
    if (process.env.NO_AUTO_EXIT === '1') {
      log.info('[lifecycle] window-all-closed -> NO_AUTO_EXIT=1 so suppress app.quit');
    } else {
      app.quit();
    }
  }
});

app.on('activate', () => {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (BrowserWindow.getAllWindows().length === 0) {
    // Don't use await here; this callback isn't async in compiled CJS.
    // Fire and forget, but log if the promise rejects.
    try {
      void createWindow();
    } catch (e) {
      const err = e as Error;
      log.error('[lifecycle] activate -> createWindow error', err?.stack || err?.message || String(err));
    }
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

// ============== Folder Watcher & Template Selection ==============
let watcherInstance: chokidar.FSWatcher | null = null;
const addTimers = new Map<string, NodeJS.Timeout>();
// 最近処理したファイルのメタを保持して重複生成を抑止
interface SeenEntry { size: number; mtimeMs: number; at: number; count: number; }
const watcherSeen = new Map<string, SeenEntry>();
const WATCHER_SEEN_TTL_MS = 30 * 60 * 1000; // 30分キャッシュ
function pruneWatcherSeen(now: number) {
  for (const [k, v] of watcherSeen) {
    if (now - v.at > WATCHER_SEEN_TTL_MS) watcherSeen.delete(k);
  }
}

function stopFolderWatcher() {
  try {
    for (const t of addTimers.values()) clearTimeout(t);
    addTimers.clear();
  } catch { /* ignore */ }
  if (watcherInstance) {
    try { watcherInstance.close(); } catch { /* ignore */ }
    watcherInstance = null;
    log.info('[watcher] stopped');
  }
}

function restartFolderWatcher() {
  stopFolderWatcher();
  const s = getAllSettings();
  const w = s?.watcher;
  if (!w?.enabled) {
    log.info('[watcher] disabled');
    return;
  }
  const dir = (w.inputDir || '').trim();
  if (!dir) {
    log.warn('[watcher] inputDir is empty; skip start');
    return;
  }
  // 画像も対象: png/jpg/jpeg/webp を追加（必要なら w.glob で上書き可能）
  const glob = w.glob || '**/*.{mp4,mov,mkv,webm,png,jpg,jpeg,webp}';
  const debounceMs = Math.max(200, Number(w.debounceMs || 1500));
  // 自己トリガー防止: 出力ディレクトリ配下と生成物パターンを監視から除外
  const absDir = path.resolve(dir);
  const configuredOutDir = (w.outputDir && w.outputDir.trim()) ? w.outputDir.trim() : (s.general.outputPath || '').trim();
  const absOut = configuredOutDir ? path.resolve(configuredOutDir) : '';
  const ignored: Array<string | RegExp> = [
    // 生成済み一時/成果物
    'work/**',
    '**/*-img2vid.mp4',
    '**/*-inter.mp4',
    '**/*-with-bgm.mp4',
    '**/*-final.mp4',
  ];
  try {
    if (absOut && absOut.startsWith(absDir)) {
      const rel = path.relative(absDir, absOut).replace(/\\/g, '/');
      if (rel && rel !== '.' && rel !== '') {
        ignored.push(`${rel}/**`);
      } else {
        // outDir が inputDir と同一。既知の生成パターン除外に依存しつつ警告を出す。
        log.warn('[watcher] outputDir equals inputDir; ignoring generated patterns to avoid self-trigger. Consider setting watcher.outputDir outside the inputDir.');
      }
    }
  } catch { /* ignore */ }
  watcherInstance = chokidar.watch(glob, { cwd: dir, ignoreInitial: true, ignored, awaitWriteFinish: { stabilityThreshold: debounceMs, pollInterval: 200 } });
  watcherInstance.on('add', (relPath) => scheduleProcessPath(path.join(dir, relPath)));
  watcherInstance.on('change', (relPath) => scheduleProcessPath(path.join(dir, relPath)));
  watcherInstance.on('error', (err) => log.warn('[watcher] error:', (err as Error)?.message || String(err)));
  log.info('[watcher] started:', { dir, glob, debounceMs });
}

function scheduleProcessPath(absPath: string) {
  try { if (addTimers.has(absPath)) clearTimeout(addTimers.get(absPath)!); } catch { /* ignore */ }
  const s = getAllSettings();
  const ms = Math.max(200, Number(s?.watcher?.debounceMs || 1500));
  // 自己トリガー防止: 出力ディレクトリ/生成物はスケジュールしない
  try {
    const w = s?.watcher;
    const configuredOutDir = (w?.outputDir && w.outputDir.trim()) ? w.outputDir.trim() : (s.general.outputPath || '').trim();
    const absOut = configuredOutDir ? path.resolve(configuredOutDir) : '';
    const p = absPath.replace(/\\/g, '/');
    const isGeneratedName = /(^|\/)work\//.test(p) || /-img2vid\.mp4$/i.test(p) || /-inter\.mp4$/i.test(p) || /-with-bgm\.mp4$/i.test(p) || /-final\.mp4$/i.test(p);
    if ((absOut && absPath.startsWith(path.resolve(absOut))) || isGeneratedName) {
      log.info('[watcher] ignore generated/output file:', absPath);
      return;
    }
  } catch { /* ignore */ }
  const to = setTimeout(() => {
    addTimers.delete(absPath);
    void processIncomingVideo(absPath).catch((e) => log.error('[watcher] process failed:', (e as Error)?.message || String(e)));
  }, ms);
  addTimers.set(absPath, to);
}

async function processIncomingVideo(filePath: string) {
  try {
    const st = await fs.stat(filePath).catch(() => null);
    if (!st || !st.isFile() || st.size <= 0) return;
  } catch { return; }
  try {
    // 自己トリガー防止: 出力ディレクトリ/生成物は処理しない
    try {
      const s = getAllSettings();
      const w = s?.watcher;
      const configuredOutDir = (w?.outputDir && w.outputDir.trim()) ? w.outputDir.trim() : (s.general.outputPath || '').trim();
      const absOut = configuredOutDir ? path.resolve(configuredOutDir) : '';
      const p = filePath.replace(/\\/g, '/');
      const isGeneratedName = /(^|\/)work\//.test(p) || /-img2vid\.mp4$/i.test(p) || /-inter\.mp4$/i.test(p) || /-with-bgm\.mp4$/i.test(p) || /-final\.mp4$/i.test(p);
      if ((absOut && filePath.startsWith(path.resolve(absOut))) || isGeneratedName) {
        log.info('[watcher] skip generated/output file:', filePath);
        return;
      }
    } catch { /* ignore */ }
    const now = Date.now();
    pruneWatcherSeen(now);
    const prev = watcherSeen.get(filePath);
    // 同一サイズ & mtime (±10ms 誤差吸収) で直近5分以内に処理済みならスキップ
    if (prev && prev.size === st.size && Math.abs(prev.mtimeMs - st.mtimeMs) < 10 && (now - prev.at) < 5 * 60 * 1000) {
      watcherSeen.set(filePath, { ...prev, at: now, count: prev.count + 1 });
      log.info('[watcher] skip duplicate:', { filePath, count: prev.count + 1 });
      return;
    }
    watcherSeen.set(filePath, { size: st.size, mtimeMs: st.mtimeMs, at: now, count: 1 });
  } catch { /* ignore duplicate logic */ }
  const s = getAllSettings();
  // Output path override
  const outDir = (s?.watcher?.outputDir && s.watcher.outputDir.trim()) ? s.watcher.outputDir : s.general.outputPath;
  const cloned: AppSettings = JSON.parse(JSON.stringify(s));
  cloned.general.outputPath = outDir;
  // Apply template if available based on filename hint: <platform>__<account>__<rest>.ext
  try {
    const base = path.basename(filePath);
    const m = base.match(/^([a-z]+)__([^_]+)__/i);
    const platform = (m?.[1]?.toLowerCase?.() || '') as Platform;
    const account = m?.[2] || '';
    if (platform && (platform === 'x' || platform === 'tiktok' || platform === 'youtube')) {
      const tpl = resolveTemplateFor(platform, account, cloned.templates?.selection, cloned.templates?.items || {});
      if (tpl) applyTemplateToSettings(cloned, tpl);
    }
  } catch { /* ignore */ }
  // 拡張子でメディア種別を判定。画像はスクショとして背景に合成、動画はソースとして扱う。
  const ext = path.extname(filePath).toLowerCase();
  const isImage = ['.png', '.jpg', '.jpeg', '.webp'].includes(ext);
  const out = await finalizeMedia({
    platform: ((): Platform => {
      try {
        const base = path.basename(filePath);
        const m = base.match(/^([a-z]+)__([^_]+)__/i);
        const pf = (m?.[1]?.toLowerCase?.() || '') as Platform;
        return (pf === 'x' || pf === 'tiktok' || pf === 'youtube') ? pf : 'x';
      } catch { return 'x'; }
    })(),
    account: null,
    inputPath: filePath,
    outputDir: cloned.general.outputPath || process.cwd(),
    settings: cloned,
  });
  log.info('[watcher] generated:', out);
}

// moved to electron/utils/templates.ts

// --- Test hooks (not used in production) ---
// Expose selected internals for unit tests
export const __test__ = {
  stopFolderWatcher,
  restartFolderWatcher,
  scheduleProcessPath,
  processIncomingVideo,
};


