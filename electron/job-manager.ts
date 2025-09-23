import PQueue from 'p-queue';
import pRetry from 'p-retry';
import Store from 'electron-store';
import log from 'electron-log';
import { app } from 'electron';
// build-touch: force recompilation to ensure latest test-run instrumentation is emitted
import type { AppSettings, Platform, Account } from '../src/core/settings';
import { resolveTemplateFor, applyTemplateToSettings } from './utils/templates';
import { scrapeAccount, ScrapeResult, listRecentItems } from './tasks/scraper';
import { generateVideo } from './tasks/video-generator';
import { captureSingleXVideo } from './tasks/capture-x-single';
import { structuredLog, emitVideoResult } from './utils/structured-log';
import path from 'node:path';
import { spawn } from 'node:child_process';
import fsn from 'node:fs';
import { downloadVideoToTemp } from './tasks/downloader';
import fs from 'node:fs/promises';

type JobStatus = 'idle' | 'running' | 'stopped';

interface PlatformJobManager {
  status: JobStatus;
  timer?: NodeJS.Timeout;
  consecutiveFails: number;
  processedCount: number; // New: for total processed count
  startTime: number; // New: for tracking start time
}

interface PlatformJobManagerState { // For persistence
  status: JobStatus;
  consecutiveFails: number;
  processedCount: number;
  startTime: number;
}

interface JobState { // Overall job state for persistence
  isRunning: boolean;
  platforms: Record<Platform, PlatformJobManagerState>;
}

// テスト実行(runTest*)専用の一時統計 (監視ジョブとは独立)
interface RunTestStats {
  startedAt: number;
  finishedAt?: number;
  timeouts: number;            // withTimeout で発生したタイムアウト回数
  skips: number;               // 処理スキップ (エラー/タイムアウト未復旧) 回数
  directCaptureAttempts: number; // X 単一動画ツイートに対する direct capture 試行回数
  xVideoUrlItems: number;      // X の item.type==='video_url' を検出した件数 (誤分類検知用)
  directCaptureSuccesses: number; // 成功した direct capture 件数 (品質ゲート強化用)
}

// 公開: Xメタデータから direct capture をスキップすべきかの判定 (単体テスト対象)
export function shouldSkipDirectCaptureFromMeta(method?: string, postType?: string): boolean {
  if (!method && !postType) return false;
  if (method === 'screenshot-only') return true; // 明示的な静止画扱い
  if (!postType) return false;
  const pt = postType.toLowerCase();
  if (pt.includes('video')) return false; // single-video / preview付き含む
  return true; // video を含まない -> 非動画としてスキップ
}

// Xメタ(JSONオブジェクト) から postType を多段探索
function extractXPostType(meta: any): string | undefined {
  if (!meta || typeof meta !== 'object') return undefined;
  return meta?.composeInfo?.postType
    || meta?.postType
    || meta?.postAnalysis?.postType
    || undefined;
}

export class JobManager {
  private store: Store<AppSettings>;
  private isRunning: boolean = false;
  private jobs: Map<Platform, PlatformJobManager> = new Map();
  private globalQueue: PQueue = new PQueue({ concurrency: 1 });
  private inFlight: Set<string> = new Set(); // dup-guard
  private recentlyProcessed: Map<string, number> = new Map(); // TTL-based dup-guard
  private readonly RECENT_TTL_MS = 10 * 60 * 1000; // 10min
  private readonly stateFilePath: string;
  // runTestLatestNAll 実行中のみ設定される一時統計
  private currentRunStats?: RunTestStats;

  constructor(store: Store<AppSettings>) {
    this.store = store;
    this.stateFilePath = path.join(app.getPath('userData'), 'job-manager-state.json');
    this.loadJobState(); // Load persisted state on initialization
  }

  // すべての有効なプラットフォーム・有効アカウントで最新N件テスト処理を一括実行（引数でフィルタ可能）
  public async runTestOnceAll(opts?: { platforms?: Platform[]; accountIds?: string[]; limit?: number }): Promise<{ totalAccounts: number; attempted: number; processed: number; }> {
    this.stop();
    const n = Math.max(1, Number(opts?.limit ?? process.env.RUN_TEST_N ?? '5'));
    log.info(`[test-run] runTestOnceAll start n=${n} opts=${JSON.stringify(opts)}`);
    try { structuredLog.emit('test-run:start', { n, opts: opts || null }); } catch { /* ignore */ }
    const summary = await this.runTestLatestNAll(n, opts);
    log.info(`[test-run] runTestOnceAll done summary=${JSON.stringify(summary)}`);
    return summary;
  }

  // 仕様対応: 各アカウントで最新N件を重複許可で処理（状態は更新しない）
  public async runTestLatestNAll(n: number, opts?: { platforms?: Platform[]; accountIds?: string[] }): Promise<{ totalAccounts: number; attempted: number; processed: number; }> {
    // 統計初期化
    this.currentRunStats = {
      startedAt: Date.now(),
      timeouts: 0,
      skips: 0,
      directCaptureAttempts: 0,
      xVideoUrlItems: 0,
      directCaptureSuccesses: 0,
    };
    const settings: AppSettings = (this.store as unknown as { store: AppSettings }).store;
    const supported = new Set<Platform>(['x','tiktok','youtube'] as Platform[]);
    const filterPlatforms = opts?.platforms ? new Set(opts.platforms) : supported;
    const filterAccounts = opts?.accountIds ? new Set(opts.accountIds) : null;
    const accounts: Array<{ platform: Platform; id: string }> = [];
    for (const platformKey of Object.keys(settings.platforms) as Platform[]) {
      if (!filterPlatforms.has(platformKey)) continue;
      const ps = settings.platforms[platformKey];
      if (!ps.enabled) continue;
      for (const acct of ps.accounts) {
        if (!acct?.isActive) continue;
        const id = (acct.id || '').trim();
        if (!id) continue;
        if (filterAccounts && !filterAccounts.has(id)) continue;
        accounts.push({ platform: platformKey, id });
      }
    }

    const attempted = accounts.length * Math.max(0, n);
    log.info(`[test-run] discovered accounts=${accounts.length} n=${n} attempted=${attempted}`);
    let processed = 0;
    // Timeout for enumeration vs processing can differ. Allow override:
    // 動画処理対応: デフォルトタイムアウトを延長
    // 【修正】動画処理対応でタイムアウトを延長
    const enumTimeoutMs = Math.max(5000, Number(process.env.RUN_TEST_ENUM_TIMEOUT_MS || process.env.RUN_TEST_TIMEOUT_MS || '300000')); // 5分に延長
    const procTimeoutMs = Math.max(3000, Number(process.env.RUN_TEST_PROC_TIMEOUT_MS || process.env.RUN_TEST_TIMEOUT_MS || '90000')); // 1.5分に延長
    const dbgFile = process.env.TEST_DEBUG_FILE;
    const appendDbg = (obj: Record<string, unknown>) => {
      if (!dbgFile) return;
      try { require('fs').appendFileSync(dbgFile, JSON.stringify({ t: new Date().toISOString(), ...obj }) + '\n'); } catch { /* ignore */ }
    };
    const withTimeout = async <T>(label: string, p: Promise<T>, ms: number): Promise<T> => {
      return await new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => {
          appendDbg({ evt: 'timeout', label, timeoutMs: ms });
          if (this.currentRunStats) this.currentRunStats.timeouts++;
          structuredLog.emit('test-run:timeout', { label, timeoutMs: ms });
          reject(new Error(`timeout:${label}:${ms}ms`));
        }, ms);
        p.then((v) => { clearTimeout(timer); resolve(v); })
         .catch((e) => { clearTimeout(timer); reject(e); });
      });
    };
    // 各アカウントで最新N件を取得（sinceCursorは無視して重複許可）
    for (const { platform, id } of accounts) {
      log.info(`[test-run] account start platform=${platform} id=${id}`);
      appendDbg({ evt: 'account-start', platform, id });
      try {
        let items: any[] = [];
        try {
          items = await withTimeout(`listRecentItems:${platform}:${id}`, listRecentItems(platform, id, n, undefined), enumTimeoutMs);
        } catch (timeoutError) {
          // X platform special handling: even on timeout, check if screenshots were generated
          if (platform === 'x') {
            log.warn(`[test-run] X platform ${id} timed out, checking for generated screenshots...`);
            appendDbg({ evt: 'x-timeout-recovery-start', platform, id });
            try {
              // Attempt to retrieve any screenshots that may have been generated during the timeout
              const fallbackItems = await listRecentItems(platform, id, n, undefined);
              if (fallbackItems && fallbackItems.length > 0) {
                items = fallbackItems;
                log.info(`[test-run] X platform ${id} timeout recovery found ${items.length} items`);
                appendDbg({ evt: 'x-timeout-recovery-success', platform, id, count: items.length });
              } else {
                appendDbg({ evt: 'x-timeout-recovery-empty', platform, id });
                throw timeoutError; // Re-throw if no recovery possible
              }
            } catch (recoveryError) {
              appendDbg({ evt: 'x-timeout-recovery-failed', platform, id, error: (recoveryError as Error)?.message });
              throw timeoutError; // Re-throw original timeout error
            }
          } else {
            throw timeoutError; // Re-throw for non-X platforms
          }
        }
        appendDbg({ evt: 'items-fetched', platform, id, count: Array.isArray(items) ? items.length : -1 });
        log.info(`[test-run] account items fetched platform=${platform} id=${id} count=${Array.isArray(items) ? items.length : -1}`);
        try {
          if (Array.isArray(items)) {
            const typeCounts: Record<string, number> = {};
            for (const it of items) { typeCounts[it.type] = (typeCounts[it.type]||0)+1; }
            log.info(`[test-run] account items types platform=${platform} id=${id} detail=${JSON.stringify(typeCounts)}`);
            appendDbg({ evt: 'items-types', platform, id, types: typeCounts });
          }
        } catch { /* ignore */ }
        let workItems = items;
        if ((!workItems || workItems.length === 0) && platform === 'x') {
          // フォールバック: 少なくとも1件スクリーンショット生成を試みる
          try {
            appendDbg({ evt: 'fallback-scrape-start', platform, id });
            const sr = await withTimeout(`fallbackScrape:${platform}:${id}`, scrapeAccount(platform, id, (this.store as unknown as { store: AppSettings }).store), enumTimeoutMs);
            if (sr && sr.type === 'screenshot') {
              workItems = [{ id: `scrape-${Date.now()}`, type: 'screenshot', path: sr.path } as any];
              appendDbg({ evt: 'fallback-scrape-success', platform, id });
              log.info(`[test-run] fallback scrape produced screenshot path=${sr.path}`);
            } else {
              appendDbg({ evt: 'fallback-scrape-empty', platform, id });
            }
          } catch (e) {
            appendDbg({ evt: 'fallback-scrape-error', platform, id, error: (e as Error)?.message });
            log.warn(`[test-run] fallback scrape failed: ${(e as Error)?.message}`);
          }
        }
        // limit件厳守・重複排除
        if (workItems && workItems.length > n) workItems = workItems.slice(0, n);
        const seenIds = new Set<string>();
        workItems = workItems.filter(it => {
          if (seenIds.has(it.id)) return false;
          seenIds.add(it.id); return true;
        });
        for (const item of workItems) {
          if (platform === 'x' && item?.type === 'video_url' && this.currentRunStats) {
            this.currentRunStats.xVideoUrlItems++;
          }
          try {
            log.info(`[test-run] process start platform=${platform} id=${id} item=${item.id} type=${item.type}`);
            appendDbg({ evt: 'process-start', platform, id, item: item.id, type: item.type });
            await withTimeout(`processItem:${platform}:${id}:${item.id}`, this.globalQueue.add(() => this.processItem(platform, id, item)), procTimeoutMs);
            log.info(`[test-run] process done platform=${platform} id=${id} item=${item.id}`);
            appendDbg({ evt: 'process-done', platform, id, item: item.id });
            processed += 1;
          } catch (e) {
            const err = e as Error;
            const msg = (err.message || '').toLowerCase();
            const isUnavailable = /members-only|members only|members on level|private video|unplayable/.test(msg);
            if (isUnavailable) {
              log.warn(`[test-run] unavailable item treated as processed (unplayable/members-only): ${platform}:${id}:${item.id} -> ${err.message}`);
              appendDbg({ evt: 'process-unavailable', platform, id, item: item.id, error: err.message });
              processed += 1;
            } else {
              log.warn(`[test-run] skip item due to error/timeout: ${platform}:${id}:${item.id} -> ${err.message}`);
              appendDbg({ evt: 'process-skip', platform, id, item: item.id, error: err.message });
              if (this.currentRunStats) this.currentRunStats.skips++;
            }
          }
        }
      } catch (e) {
        const err = e as Error; log.warn(`[test-run] account skipped due to error/timeout: ${platform}:${id} -> ${err.message}`);
        appendDbg({ evt: 'account-skip', platform, id, error: err.message });
      }
      log.info(`[test-run] account end platform=${platform} id=${id}`);
      appendDbg({ evt: 'account-end', platform, id });
    }
    if (this.currentRunStats) this.currentRunStats.finishedAt = Date.now();
  const stats = this.currentRunStats || { timeouts: 0, skips: 0, directCaptureAttempts: 0, directCaptureSuccesses: 0, startedAt: 0, finishedAt: 0, xVideoUrlItems: 0 };
    const timeoutRate = attempted > 0 ? stats.timeouts / attempted : 0;
    appendDbg({ evt: 'run-finish', totalAccounts: accounts.length, attempted, processed, stats: { ...stats, timeoutRate } });
    structuredLog.emit('test-run:finish', { totalAccounts: accounts.length, attempted, processed, timeoutRate, stats });
    // 品質ゲート判定ブロック
    // 1) video_url が存在するのに direct capture attempt が 0 → 重大な劣化
    if (stats.directCaptureAttempts === 0 && stats.xVideoUrlItems > 0) {
      structuredLog.emit('test-run:quality-degradation', {
        reason: 'no-direct-capture-for-x-video-url',
        xVideoUrlItems: stats.xVideoUrlItems,
        directCaptureAttempts: stats.directCaptureAttempts,
        directCaptureSuccesses: stats.directCaptureSuccesses,
        attempted,
        processed,
      });
      appendDbg({ evt: 'quality-degradation', reason: 'no-direct-capture-for-x-video-url', xVideoUrlItems: stats.xVideoUrlItems });
    } else if (stats.xVideoUrlItems > 0) {
      // 2) 一部は attempt されたが成功 0 → キャプチャ失敗率100%
      if (stats.directCaptureAttempts > 0 && stats.directCaptureSuccesses === 0) {
        structuredLog.emit('test-run:quality-warning', {
          reason: 'all-direct-captures-failed',
          xVideoUrlItems: stats.xVideoUrlItems,
          directCaptureAttempts: stats.directCaptureAttempts,
          directCaptureSuccesses: stats.directCaptureSuccesses,
          attempted,
          processed,
        });
        appendDbg({ evt: 'quality-warning', reason: 'all-direct-captures-failed' });
      }
      // 3) video_url 件数 > attempt 件数 (分類された video_url に対し direct capture 試行漏れ疑い)
      if (stats.directCaptureAttempts < stats.xVideoUrlItems) {
        structuredLog.emit('test-run:quality-warning', {
          reason: 'missing-attempts-for-some-x-video-url',
          xVideoUrlItems: stats.xVideoUrlItems,
          directCaptureAttempts: stats.directCaptureAttempts,
          directCaptureSuccesses: stats.directCaptureSuccesses,
          attempted,
          processed,
        });
        appendDbg({ evt: 'quality-warning', reason: 'missing-attempts-for-some-x-video-url' });
      }
      // 4) 失敗率が 50% 超: successes / attempts < 0.5
      if (stats.directCaptureAttempts > 2 && stats.directCaptureSuccesses / stats.directCaptureAttempts < 0.5) {
        structuredLog.emit('test-run:quality-warning', {
          reason: 'high-direct-capture-failure-rate',
          failureRate: 1 - (stats.directCaptureSuccesses / stats.directCaptureAttempts),
          xVideoUrlItems: stats.xVideoUrlItems,
          directCaptureAttempts: stats.directCaptureAttempts,
          directCaptureSuccesses: stats.directCaptureSuccesses,
          attempted,
          processed,
        });
        appendDbg({ evt: 'quality-warning', reason: 'high-direct-capture-failure-rate' });
      }
    }
    // 実行終了後クリア（監視ジョブには影響させない）
    // --- GUI テスト生成用ログを動画出力先へ書き出し ---
    try {
      const settingsForLog: AppSettings = (this.store as unknown as { store: AppSettings }).store;
      const outDirRaw = settingsForLog?.general?.outputPath || '';
      if (outDirRaw) {
        const outDir = path.resolve(outDirRaw);
        try { fsn.mkdirSync(outDir, { recursive: true }); } catch {}
        const ts = stats.startedAt ? new Date(stats.startedAt).toISOString().replace(/[:.]/g,'-') : Date.now();
        const baseName = `test-run-${ts}`;
        const summaryObj = { version: 1, generatedAt: new Date().toISOString(), attempted, processed, stats };
        const logPath = path.join(outDir, `${baseName}.json`);
        try { fsn.writeFileSync(logPath, JSON.stringify(summaryObj, null, 2), 'utf8'); } catch {}
        // summary-events.jsonl を複製 (存在すれば)
        try {
          const runLatestDir = path.join(app.getPath('userData'), 'logs', 'test-run-latest');
            const summaryEvents = path.join(runLatestDir, 'summary-events.jsonl');
            if (fsn.existsSync(summaryEvents)) {
              const copyTarget = path.join(outDir, `${baseName}.events.jsonl`);
              fsn.copyFileSync(summaryEvents, copyTarget);
            }
        } catch { /* ignore copy errors */ }
      }
    } catch { /* ignore log write errors */ }
    // ----------------------------------------------------
    this.currentRunStats = undefined;
    return { totalAccounts: accounts.length, attempted, processed };
  }

  private loadJobState() {
    try {
      if (!fsn.existsSync(this.stateFilePath)) return; // No state file, use defaults
      const stateData = fsn.readFileSync(this.stateFilePath, 'utf-8');
      const state: JobState = JSON.parse(stateData);
      this.isRunning = state.isRunning;
      for (const [platform, jobState] of Object.entries(state.platforms)) {
        this.jobs.set(platform as Platform, {
          status: jobState.status,
          consecutiveFails: jobState.consecutiveFails,
          processedCount: jobState.processedCount,
          startTime: jobState.startTime,
        });
      }
      log.info('Loaded job state from disk:', JSON.stringify(state));
    } catch (error) {
      log.error('Failed to load job state:', (error as Error)?.message || String(error));
    }
  }

  private saveJobState() {
    try {
      const state: JobState = {
        isRunning: this.isRunning,
        platforms: {} as Record<Platform, PlatformJobManagerState>,
      };
      for (const [platform, job] of this.jobs.entries()) {
        state.platforms[platform] = {
          status: job.status,
          consecutiveFails: job.consecutiveFails,
          processedCount: job.processedCount,
          startTime: job.startTime,
        };
      }
      fsn.writeFileSync(this.stateFilePath, JSON.stringify(state, null, 2));
      log.debug('Saved job state to disk.');
    } catch (error) {
      log.error('Failed to save job state:', (error as Error)?.message || String(error));
    }
  }

  public start() {
    if (this.isRunning) return;
    this.isRunning = true;
    this.saveJobState(); // Save state when starting
    log.info('JobManager is starting.');

    const settings: AppSettings = (this.store as unknown as { store: AppSettings }).store;
    for (const [platform, platformSettings] of Object.entries(settings.platforms) as [Platform, any][]) {
      if (platformSettings.enabled && platformSettings.accounts.some((account: Account) => account.isActive)) {
        this.startPlatformJob(platform, platformSettings);
      }
    }
  }

  public stop() {
    if (!this.isRunning) return;
    this.isRunning = false;
    this.saveJobState(); // Save state when stopping
    log.info('JobManager is stopping.');

    for (const platform of this.jobs.keys()) {
      this.stopPlatformJob(platform);
    }
  }

  private startPlatformJob(platform: Platform, platformSettings: any) {
    let job = this.jobs.get(platform);
    
    // If job exists from previous session, use its state, otherwise initialize
    job = job || {
      status: 'running',
      consecutiveFails: 0,
      processedCount: 0,
      startTime: Date.now(),
    };
    job.status = 'running'; // Ensure status is running when starting
    this.jobs.set(platform, job);
    this.saveJobState(); // Save state when platform job starts

    const run = () => {
      if (job.status !== 'running') return;
      log.info(`Adding monitoring tasks for ${platform} to the global queue.`);
      let delay = 0;
      platformSettings.accounts.forEach((account: Account) => {
        if (!account.isActive) return;
        const thisDelay = delay;
        delay += Math.max(0, platformSettings.scrapeDelayMs || 0);
        this.globalQueue.add(async () => {
          if (thisDelay > 0) await new Promise(r => setTimeout(r, thisDelay));
          return this.runMonitoringTask(platform, account.id);
        });
      });
    };
    
    run(); // Initial run
    const intervalMillis = platformSettings.intervalMinutes * 60 * 1000;
    job.timer = setInterval(run, intervalMillis);
    log.info(`Scheduled job for ${platform} every ${platformSettings.intervalMinutes} minutes.`);
  }

  private stopPlatformJob(platform: Platform) {
    const job = this.jobs.get(platform);
    if (job) {
      if (job.timer) clearInterval(job.timer);
      job.status = 'stopped';
      this.saveJobState(); // Save state when platform job stops
      log.info(`Job for platform ${platform} stopped.`);
    }
  }

  public getStatus() {
    const status: { isRunning: boolean; globalQueueSize: number; globalPendingTasks: number; platforms: Record<string, { status: JobStatus; consecutiveFails: number; processedCount: number; elapsedTime: number }> } = {
      isRunning: this.isRunning,
      globalQueueSize: this.globalQueue.size, // New: Global queue size
      globalPendingTasks: this.globalQueue.pending, // New: Global pending tasks
      platforms: {},
    };
    for (const [platform, job] of this.jobs.entries()) {
      status.platforms[platform] = {
        status: job.status,
        consecutiveFails: job.consecutiveFails,
        processedCount: job.processedCount, // New: Processed count
        elapsedTime: Date.now() - job.startTime, // New: Elapsed time
      };
    }
    return status;
  }

  private async runMonitoringTask(platform: Platform, accountId: string) {
    const job = this.jobs.get(platform);
    if (!job || job.status !== 'running') return; // Ensure job is still running

    const task = async () => {
      log.info(`Running task for ${platform}: ${accountId}`);

      // 設定から対象アカウントの状態を参照
      const settings: AppSettings = (this.store as unknown as { store: AppSettings }).store;
      const acct = settings.platforms[platform].accounts.find(a => a.id === accountId);
      // 一般設定 initialBackfillCount はアカウント追加時に backfillRemaining に反映済み
      // ここでは残数を参照し、初回のみ実行。完了後は0に設定して以後は lastCursor を用いて新規のみを処理
      const backfillCount = Math.max(0, Math.min(50, acct?.backfillRemaining ?? 0));

      if (backfillCount > 0) {
        // 初回バックフィル：過去N件のアイテム一覧を取得して順次処理
        // listRecentItems は { id, type, url?, screenshotSelector? }[] を返す想定
        let items = await listRecentItems(platform, accountId, backfillCount, acct?.lastCursor);
        // 既処理IDでフィルタ（重複ダウンロード/生成を避ける）
        const processed = new Set(acct?.processedIds || []);
        items = items.filter(i => !processed.has(i.id) && !this.isRecentlyProcessed(platform, accountId, i.id));
        log.info(`[${platform}:${accountId}] Backfill ${items.length} item(s).`);
        for (const item of items) {
          await this.processItem(platform, accountId, item);
          // カーソル更新（最後に処理したID）
          (this.store as unknown as { set: (k: string, v: unknown) => void }).set(`platforms.${platform}.accounts`, settings.platforms[platform].accounts.map(a => a.id === accountId ? { ...a, lastCursor: item.id } : a));
          // processedIds へ追記（最大500件保持）
          const newAccounts = settings.platforms[platform].accounts.map(a => {
            if (a.id !== accountId) return a;
            const arr = Array.isArray(a.processedIds) ? [...a.processedIds] : [];
            arr.push(item.id);
            const trimmed = arr.length > 500 ? arr.slice(arr.length - 500) : arr;
            return { ...a, processedIds: trimmed };
          });
          (this.store as unknown as { set: (k: string, v: unknown) => void }).set(`platforms.${platform}.accounts`, newAccounts);
        }
        // 残数を0に
        (this.store as unknown as { set: (k: string, v: unknown) => void }).set(`platforms.${platform}.accounts`, settings.platforms[platform].accounts.map(a => a.id === accountId ? { ...a, backfillRemaining: 0 } : a));
        log.info(`[${platform}:${accountId}] Backfill completed.`);
      } else {
        // 通常運用：新規のみ（lastCursor より新しい最新1件を対象）
        let items = await listRecentItems(platform, accountId, 1, acct?.lastCursor);
        const processed = new Set(acct?.processedIds || []);
        items = items.filter(i => !processed.has(i.id) && !this.isRecentlyProcessed(platform, accountId, i.id));
        if (items.length > 0) {
          const item = items[0];
          await this.processItem(platform, accountId, item);
          (this.store as unknown as { set: (k: string, v: unknown) => void }).set(`platforms.${platform}.accounts`, settings.platforms[platform].accounts.map(a => a.id === accountId ? { ...a, lastCursor: item.id } : a));
          // processedIds 更新（最大500件）
          const newAccounts = settings.platforms[platform].accounts.map(a => {
            if (a.id !== accountId) return a;
            const arr = Array.isArray(a.processedIds) ? [...a.processedIds] : [];
            arr.push(item.id);
            const trimmed = arr.length > 500 ? arr.slice(arr.length - 500) : arr;
            return { ...a, processedIds: trimmed };
          });
          (this.store as unknown as { set: (k: string, v: unknown) => void }).set(`platforms.${platform}.accounts`, newAccounts);
        } else {
          log.info(`[${platform}:${accountId}] No new items to process.`);
        }
      }
    };

    try {
      // Add max execution time (e.g., 5 minutes)
      await Promise.race([
        pRetry(task, {
          retries: 3,
          minTimeout: 5000, // 5 seconds
          onFailedAttempt: (error: { attemptNumber: number; retriesLeft: number; message?: string }) => {
            log.warn(`[${platform}:${accountId}] Attempt ${error.attemptNumber} failed. There are ${error.retriesLeft} retries left. Reason: ${error.message}`);
          },
        }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Task timed out')), 15 * 60 * 1000)) // 15 minutes timeout
      ]);
      job.consecutiveFails = 0; // Reset on success
      job.processedCount++; // Increment processed count on success
      this.saveJobState(); // Save state on task success

      // Check for total processed count and time limit
      const elapsedTimeHours = (Date.now() - job.startTime) / (1000 * 60 * 60);
      if (job.processedCount >= 100 && elapsedTimeHours <= 1) {
        log.warn(`[${platform}] Job processed 100 tasks within 1 hour. Stopping job for this platform.`);
        this.stopPlatformJob(platform);
      }

    } catch (error) {
      const e = error as Error;
      log.error(`[${platform}:${accountId}] Task failed after all retries or timed out:`, e.message || String(error));
      job.consecutiveFails++;
      this.saveJobState(); // Save state on task failure
      if (job.consecutiveFails >= 10) {
        log.error(`[${platform}] Job has failed 10 consecutive times. Stopping job for this platform.`);
        this.stopPlatformJob(platform);
      }
    }
  }

  // 即時バックフィル実行（アカウント追加直後の「はい」から呼び出し）
  public async enqueueImmediateBackfill(platform: Platform, accountId: string): Promise<void> {
    const settings: AppSettings = (this.store as unknown as { store: AppSettings }).store;
    const acct = settings.platforms[platform].accounts.find(a => a.id === accountId);
    if (!acct) return;
    const count = Math.max(0, Math.min(50, acct.backfillRemaining ?? settings.general.initialBackfillCount ?? 0));
    if (count <= 0) return;
    // ジョブ状態に依存しない即時実行（one-off）。グローバルキューで直列化。
    await this.globalQueue.add(async () => this.runImmediateBackfill(platform, accountId));
  }

  // 内部: 即時バックフィル本体（ジョブ状態に依存しない）
  private async runImmediateBackfill(platform: Platform, accountId: string): Promise<void> {
    try {
      const settings: AppSettings = (this.store as unknown as { store: AppSettings }).store;
      const acct = settings.platforms[platform].accounts.find(a => a.id === accountId);
      if (!acct) return;
      const backfillCount = Math.max(0, Math.min(50, acct.backfillRemaining ?? settings.general.initialBackfillCount ?? 0));
      if (backfillCount <= 0) return;
      let items = await listRecentItems(platform, accountId, backfillCount, acct.lastCursor);
      const processed = new Set(acct.processedIds || []);
      items = items.filter(i => !processed.has(i.id));
      log.info(`[${platform}:${accountId}] Immediate backfill ${items.length} item(s).`);
      for (const item of items) {
        await this.processItem(platform, accountId, item);
        // lastCursor 更新
        (this.store as unknown as { set: (k: string, v: unknown) => void }).set(
          `platforms.${platform}.accounts`,
          settings.platforms[platform].accounts.map(a => a.id === accountId ? { ...a, lastCursor: item.id } : a)
        );
        // processedIds 更新（最大500件）
        const newAccounts = settings.platforms[platform].accounts.map(a => {
          if (a.id !== accountId) return a;
          const arr = Array.isArray(a.processedIds) ? [...a.processedIds] : [];
          arr.push(item.id);
          const trimmed = arr.length > 500 ? arr.slice(arr.length - 500) : arr;
          return { ...a, processedIds: trimmed };
        });
        (this.store as unknown as { set: (k: string, v: unknown) => void }).set(`platforms.${platform}.accounts`, newAccounts);
      }
      // 残数を0に
      (this.store as unknown as { set: (k: string, v: unknown) => void }).set(
        `platforms.${platform}.accounts`,
        settings.platforms[platform].accounts.map(a => a.id === accountId ? { ...a, backfillRemaining: 0 } : a)
      );
      log.info(`[${platform}:${accountId}] Immediate backfill completed.`);
    } catch (error) {
      const e = error as Error;
      log.error(`[${platform}:${accountId}] Immediate backfill failed:`, e.message || String(error));
      throw error;
    }
  }

  // 内部: 最新1件のみの即時処理（重複回避）。処理したらtrueを返す
  private async runImmediateOneLatest(platform: Platform, accountId: string, opts?: { allowDuplicates?: boolean; noStateUpdate?: boolean }): Promise<boolean> {
    const settings: AppSettings = (this.store as unknown as { store: AppSettings }).store;
    const acct = settings.platforms[platform].accounts.find(a => a.id === accountId);
    if (!acct) return false;
    let items = await listRecentItems(platform, accountId, 1, opts?.noStateUpdate ? undefined : acct.lastCursor);
    if (!opts?.allowDuplicates) {
      const processed = new Set(acct.processedIds || []);
      items = items.filter(i => !processed.has(i.id) && !this.isRecentlyProcessed(platform, accountId, i.id));
    }
    // フォールバック: 最新1件が既処理なら、過去数件から未処理を選定
    if (items.length === 0) {
      const depth = 5;
      let more = await listRecentItems(platform, accountId, depth, undefined);
      if (!opts?.allowDuplicates) {
        const processed = new Set(acct.processedIds || []);
        more = more.filter(i => !processed.has(i.id) && !this.isRecentlyProcessed(platform, accountId, i.id));
      }
      items = more.slice(0, 1);
    }
    if (items.length === 0) {
      log.info(`[${platform}:${accountId}] No item to process for one-off.`);
      return false;
    }
    const item = items[0];
    await this.processItem(platform, accountId, item);
    if (!opts?.noStateUpdate) {
      // 更新: lastCursor と processedIds（最大500件）
      (this.store as unknown as { set: (k: string, v: unknown) => void }).set(
        `platforms.${platform}.accounts`,
        settings.platforms[platform].accounts.map(a => a.id === accountId ? { ...a, lastCursor: item.id } : a)
      );
      const newAccounts = settings.platforms[platform].accounts.map(a => {
        if (a.id !== accountId) return a;
        const arr = Array.isArray(a.processedIds) ? [...a.processedIds] : [];
        arr.push(item.id);
        const trimmed = arr.length > 500 ? arr.slice(arr.length - 500) : arr;
        return { ...a, processedIds: trimmed };
      });
      (this.store as unknown as { set: (k: string, v: unknown) => void }).set(`platforms.${platform}.accounts`, newAccounts);
    }
    return true;
  }

  private async processItem(platform: Platform, accountId: string, item: { id: string; type: 'screenshot'|'video_url'; url?: string; path?: string }) {
    // スクレイピング済みアイテムから動画生成実行
    const key = `${platform}:${accountId}:${item.id}`;
    if (this.inFlight.has(key)) {
      log.info(`[dup-guard] Skip processing already in-flight: ${key}`);
      return;
    }
    this.inFlight.add(key);
    let videoPath = '';
    // runTest* パスでのみ TEST_DEBUG_FILE が設定され appendDbg 利用可能
    const dbgFile = process.env.TEST_DEBUG_FILE;
    const phase = (p: string, extra: any = {}) => {
      if (!dbgFile) return;
      try { require('fs').appendFileSync(dbgFile, JSON.stringify({ t: new Date().toISOString(), evt: 'proc-phase', platform, id: accountId, item: item.id, phase: p, ...extra })+'\n'); } catch { /* ignore */ }
    };
    phase('start');
    try {
      // Prepare settings with optional template applied
      const baseSettings: AppSettings = (this.store as unknown as { store: AppSettings }).store;
      const cloned: AppSettings = JSON.parse(JSON.stringify(baseSettings));
      try {
        const tpl = resolveTemplateFor(platform, accountId, cloned.templates?.selection, cloned.templates?.items || {});
        if (tpl) applyTemplateToSettings(cloned, tpl);
      } catch { /* ignore */ }
      if (item.type === 'screenshot') {
        if (!item.path) {
          // 互換: 以前の1件スクレイプフローにフォールバック
          phase('scrape-start');
          const scrapeResult = await scrapeAccount(platform, accountId, (this.store as unknown as { store: AppSettings }).store);
          if (!scrapeResult) throw new Error('Scraping did not return a result.');
          if (scrapeResult.type !== 'screenshot') throw new Error('Expected screenshot item.');
          const shotPath = scrapeResult.path;
          // --- X専用: 直接動画キャプチャ統合 (単一動画ポスト判定 & capture module) ---
          if (platform === 'x') {
            const tweetIdForUrl = item.id; // item.id は tweetId である前提 (listRecentItemsX_viaBackend)
            const tweetUrl = /^\d+$/.test(tweetIdForUrl) ? `https://x.com/${accountId}/status/${tweetIdForUrl}` : (item.url && item.url.includes('https://x.com/') ? item.url : null);
            if (tweetUrl) {
              phase('direct-capture-start', { tweetUrl });
              structuredLog.emit('process:direct-capture-start', { platform, accountId, tweetUrl, item: item.id });
              if (this.currentRunStats) this.currentRunStats.directCaptureAttempts++;
              try {
                const cap = await captureSingleXVideo({ tweetUrl, outDir: path.dirname(shotPath), debugFile: process.env.TEST_DEBUG_FILE });
                if (cap.kind === 'video' && cap.mp4Path) {
                  phase('direct-capture-success', { mp4: cap.mp4Path, duration: cap.durationSec });
                  structuredLog.emit('process:direct-capture-success', { platform, accountId, tweetUrl, mp4: cap.mp4Path, duration: cap.durationSec, item: item.id });
                  if (this.currentRunStats) this.currentRunStats.directCaptureSuccesses++;
                  emitVideoResult({
                    platform,
                    accountId,
                    tweetId: tweetUrl.split('/status/')[1],
                    itemId: item.id,
                    file: cap.mp4Path,
                    postType: 'single-video',
                    strategyChain: ['capture-x-single'],
                    audioExpected: true,
                    // audioDetected は capture-x-single 側の probe ログを参照 (ここでは未知)
                    method: 'direct-capture'
                  });
                  // 動画ソースとして生成フロー（generateVideo 第3引数に入力動画パス）
                  phase('generate-start', { kind: 'direct-video' });
                  videoPath = await generateVideo('', cloned, cap.mp4Path);
                  phase('generate-done', { direct: true });
                  structuredLog.emit('process:generate-done', { platform, accountId, item: item.id, direct: true, output: videoPath });
                } else if (cap.kind === 'unplayable') {
                  phase('direct-capture-unplayable', { reason: cap.reason });
                  structuredLog.emit('process:direct-capture-unplayable', { platform, accountId, tweetUrl, reason: cap.reason, item: item.id });
                  // フォールバックでスクリーンショットをそのまま利用
                } else {
                  phase('direct-capture-fallback', { reason: cap.reason || 'not-video' });
                  structuredLog.emit('process:direct-capture-fallback', { platform, accountId, tweetUrl, reason: cap.reason || 'not-video', item: item.id });
                }
              } catch (e) {
                phase('direct-capture-error', { error: (e as Error)?.message });
                structuredLog.emit('process:direct-capture-error', { platform, accountId, tweetUrl, error: (e as Error)?.message, item: item.id });
              }
            } else {
              phase('direct-capture-skip', { reason: 'no-tweet-url' });
              structuredLog.emit('process:direct-capture-skip', { platform, accountId, item: item.id, reason: 'no-tweet-url' });
            }
          }
          if (!videoPath) {
            phase('generate-start', { kind: 'screenshot' });
            videoPath = await generateVideo(shotPath, cloned);
            phase('generate-done');
          }
        } else {
          // スクリーンショットが存在しない/サイズ0の場合は再取得して補完
          let shot = item.path;
          let needRefetch = false;
          try {
            const st = await fs.stat(shot);
            if (!st.isFile() || st.size <= 0) needRefetch = true;
          } catch { needRefetch = true; }
          if (needRefetch) {
            log.warn(`[${platform}:${accountId}] Screenshot missing/empty. Refetching via scrapeAccount...`);
            phase('refetch-start');
            const sr = await scrapeAccount(platform, accountId, (this.store as unknown as { store: AppSettings }).store);
            if (sr && sr.type === 'screenshot') {
              shot = sr.path;
            } else {
              throw new Error('Failed to refetch screenshot');
            }
            phase('refetch-done');
          }
          // --- X専用: 直接動画キャプチャ統合 ---
          if (platform === 'x') {
            // 追加: CLI 側メタ (composeInfo.method === 'screenshot-only' / postType !== 'video') を検出して
            // 明示的に非動画ツイートと分類されたスクリーンショットについては direct capture をスキップし、
            // 不要なブラウザインスタンス起動時間を削減する。
            let skipDirectCapture = false;
            // 重複していたローカル判定関数を除去し export 関数一本化
            try {
              if (shot && shot.toLowerCase().endsWith('.png')) {
                const metaPath = shot.replace(/\.png$/i, '.json');
                let meta: any = undefined;
                let method: string | undefined;
                let postType: string | undefined;
                let metaLoaded = false;
                // メタはスクレイプ直後に非同期書き込みされる可能性があるため短期リトライ (環境変数で調整可)
                const META_READ_MAX_RETRY = parseInt(process.env.META_READ_MAX_RETRY || '3', 10);
                const META_READ_RETRY_INTERVAL_MS = parseInt(process.env.META_READ_RETRY_INTERVAL_MS || '60', 10);
                for (let attempt = 0; attempt < META_READ_MAX_RETRY && !metaLoaded; attempt++) {
                  const metaRaw = await fs.readFile(metaPath, 'utf8').catch(() => null);
                  if (!metaRaw) {
                    if (attempt < META_READ_MAX_RETRY - 1) await new Promise(r => setTimeout(r, META_READ_RETRY_INTERVAL_MS));
                    continue;
                  }
                  try {
                    meta = JSON.parse(metaRaw);
                    method = meta?.composeInfo?.method || meta?.method;
                    postType = extractXPostType(meta);
                    metaLoaded = true;
                  } catch {
                    if (attempt < META_READ_MAX_RETRY - 1) await new Promise(r => setTimeout(r, META_READ_RETRY_INTERVAL_MS));
                  }
                }
                if (!metaLoaded) {
                  structuredLog.emit('process:x-meta-missing', { platform, accountId, item: item.id, metaPath });
                } else {
                  // スキーマ簡易検証 (未知 postType の早期検出)
                  // postType 表記ゆれ (single-video / single_video) を正規化して既知判定
                  const normalizePostType = (pt?: string) => pt ? pt.replace(/-/g, '_') : pt;
                  const knownPostTypes = new Set([
                    'single_video',
                    'single_video_with_preview',
                    'multi_video',
                    'text',
                    'image',
                    'mixed',
                    'unknown'
                  ]);
                  const normalized = normalizePostType(postType);
                  if (postType && normalized && !knownPostTypes.has(normalized)) {
                    structuredLog.emit('process:x-meta-unknown-posttype', { platform, accountId, item: item.id, postType });
                  }
                  if (shouldSkipDirectCaptureFromMeta(method, postType)) {
                    skipDirectCapture = true;
                    phase('direct-capture-skip-screenshot-only', { reason: 'classified-non-video', postType, method });
                    structuredLog.emit('process:x-screenshot-only-skip-video', { platform, accountId, item: item.id, postType, method });
                  }
                  structuredLog.emit('process:x-meta-evaluated', { platform, accountId, item: item.id, method, postType, skipDirectCapture });
                }
              }
            } catch { /* ignore meta read errors */ }
            const tweetIdForUrl = item.id;
            const tweetUrl = /^\d+$/.test(tweetIdForUrl) ? `https://x.com/${accountId}/status/${tweetIdForUrl}` : (item.url && item.url.includes('https://x.com/') ? item.url : null);
            if (tweetUrl && !skipDirectCapture) {
              phase('direct-capture-start', { tweetUrl });
              structuredLog.emit('process:direct-capture-start', { platform, accountId, tweetUrl, item: item.id });
              if (this.currentRunStats) this.currentRunStats.directCaptureAttempts++;
              try {
                const cap = await captureSingleXVideo({ tweetUrl, outDir: path.dirname(shot), debugFile: process.env.TEST_DEBUG_FILE });
                if (cap.kind === 'video' && cap.mp4Path) {
                  phase('direct-capture-success', { mp4: cap.mp4Path, duration: cap.durationSec });
                  structuredLog.emit('process:direct-capture-success', { platform, accountId, tweetUrl, mp4: cap.mp4Path, duration: cap.durationSec, item: item.id });
                  if (this.currentRunStats) this.currentRunStats.directCaptureSuccesses++;
                  phase('generate-start', { kind: 'direct-video' });
                  videoPath = await generateVideo('', cloned, cap.mp4Path);
                  phase('generate-done', { direct: true });
                  structuredLog.emit('process:generate-done', { platform, accountId, item: item.id, direct: true, output: videoPath });
                } else if (cap.kind === 'unplayable') {
                  phase('direct-capture-unplayable', { reason: cap.reason });
                  structuredLog.emit('process:direct-capture-unplayable', { platform, accountId, tweetUrl, reason: cap.reason, item: item.id });
                } else {
                  phase('direct-capture-fallback', { reason: cap.reason || 'not-video' });
                  structuredLog.emit('process:direct-capture-fallback', { platform, accountId, tweetUrl, reason: cap.reason || 'not-video', item: item.id });
                }
              } catch (e) {
                phase('direct-capture-error', { error: (e as Error)?.message });
                structuredLog.emit('process:direct-capture-error', { platform, accountId, tweetUrl, error: (e as Error)?.message, item: item.id });
              }
            } else if (!skipDirectCapture) {
              phase('direct-capture-skip', { reason: 'no-tweet-url' });
              structuredLog.emit('process:direct-capture-skip', { platform, accountId, item: item.id, reason: 'no-tweet-url' });
            }
          }
          if (!videoPath) {
            phase('generate-start', { kind: 'screenshot' });
            videoPath = await generateVideo(shot, cloned);
            phase('generate-done');
          }
        }
      } else if (item.type === 'video_url') {
        const url = item.url || '';
        // If url is a local file path (or file:// URL), skip downloader and use it directly.
        let sourcePath: string | null = null;
        try {
          const u = url.trim();
          if (u.startsWith('file://')) {
            // Lazy import to avoid top-level dependency for URL utils
            const { fileURLToPath } = await import('node:url');
            try { sourcePath = fileURLToPath(u); } catch { sourcePath = null; }
          } else {
            // On Windows absolute paths may include drive letters; verify existence
            if (require('node:path').isAbsolute(u) && require('node:fs').existsSync(u)) {
              sourcePath = u;
            }
          }
        } catch { /* ignore */ }

        if (sourcePath) {
          phase('download-skip-local', { path: sourcePath });
          phase('generate-start', { kind: 'video_url-local' });
          videoPath = await generateVideo('', cloned, sourcePath);
          phase('generate-done');
        } else {
          // Otherwise download the video to a local temp file, then feed to ffmpeg
          phase('download-start', { url });
          const dl = await downloadVideoToTemp(url, platform);
          phase('download-done');
          phase('generate-start', { kind: 'video_url' });
          videoPath = await generateVideo('', cloned, dl.filepath);
          phase('generate-done');
        }
      } else {
        throw new Error(`Unknown item type: ${item.type}`);
      }
      // After base video is generated, optionally run kuroma for chroma-key compositing if configured
      try {
        const ps = cloned.platforms[platform];
        const chroma = ps?.chroma;
        // IMPORTANT: Apply chroma onto the already generated non-chroma video (videoPath)
        // to match the required spec. Do NOT use the configured background directly here.
        if (chroma?.enabled && videoPath && fsn.existsSync(videoPath)) {
          phase('chroma-start');
          structuredLog.emit('process:chroma-start', { platform, accountId, item: item.id, videoPath });
          // Pick foreground
          let fg: string | null = null;
          if ((chroma.mode || 'fixed') === 'fixed') {
            fg = (chroma.foregroundPath || '').trim() || null;
          } else {
            const dir = (chroma.foregroundDir || '').trim();
            if (dir && fsn.existsSync(dir)) {
              const entries = fsn.readdirSync(dir).filter((f) => /\.(mp4|mov|mkv|webm|png|jpg|jpeg)$/i.test(f));
              if (entries.length > 0) {
                const pick = entries[Math.floor(Math.random() * entries.length)];
                fg = path.join(dir, pick);
              }
            }
          }
          // Verification requirement: use known sample if nothing specified
          if (!fg || !fsn.existsSync(fg)) {
            // Resolve sample path from app resources (packaged and dev both supported)
            let appPath = '';
            try { appPath = app.getAppPath(); } catch { appPath = process.cwd(); }
            
            // Development mode - direct file access
            const devCandidates = [
              path.join(process.cwd(), 'kuroma', 'test_videos', 'foreground.mp4'),
              path.join(appPath, 'kuroma', 'test_videos', 'foreground.mp4'),
            ];
            const directFg = devCandidates.find((p) => fsn.existsSync(p));
            
            if (directFg) {
              fg = directFg;
            } else {
              // Packaged mode - extract from ASAR to temp location
              const os = require('os');
              const tempDir = path.join(os.tmpdir(), 'shortvideo-kuroma-extract');
              try {
                fsn.mkdirSync(tempDir, { recursive: true });
              } catch {}
              
              const tempFgPath = path.join(tempDir, 'foreground.mp4');
              try {
                // Try to read from ASAR and extract
                const asarFgPath = path.join(appPath, 'kuroma', 'test_videos', 'foreground.mp4');
                const fgBuffer = fsn.readFileSync(asarFgPath);
                fsn.writeFileSync(tempFgPath, fgBuffer);
                fg = tempFgPath;
              } catch (e) {
                log.warn('[kuroma] Failed to extract foreground.mp4 from ASAR:', (e as Error)?.message || String(e));
                fg = null; // Skip kuroma if no foreground available
              }
            }
          }
          if (fg && fsn.existsSync(fg)) {
            const outDir = cloned.general.outputPath || path.dirname(videoPath);
            // Write to a temporary chroma path, then atomically replace the original to avoid duplicate outputs
            const tmpOut = path.join(outDir, `${path.basename(videoPath, path.extname(videoPath))}.chroma.tmp.mp4`);
            const py = process.env.PYTHON || 'python';
            // Resolve kuroma cli.py path from app resources - handle ASAR packaging
            let cliPath: string;
            let appPath = '';
            try { appPath = app.getAppPath(); } catch { appPath = process.cwd(); }
            
            // Development mode - direct file access
            const devCandidates = [
              path.join(process.cwd(), 'kuroma', 'cli.py'),
              path.join(appPath, 'kuroma', 'cli.py'),
            ];
            const directPath = devCandidates.find((p) => fsn.existsSync(p));
            
            if (directPath) {
              cliPath = directPath;
            } else {
              // Packaged mode - extract from ASAR to temp location
              const os = require('os');
              const tempDir = path.join(os.tmpdir(), 'shortvideo-kuroma-extract');
              try {
                fsn.mkdirSync(tempDir, { recursive: true });
              } catch {}
              
              const tempCliPath = path.join(tempDir, 'cli.py');
              try {
                // Try to read from ASAR and extract
                const asarCliPath = path.join(appPath, 'kuroma', 'cli.py');
                const cliContent = fsn.readFileSync(asarCliPath, 'utf8');
                fsn.writeFileSync(tempCliPath, cliContent, 'utf8');
                cliPath = tempCliPath;
              } catch (e) {
                log.warn('[kuroma] Failed to extract cli.py from ASAR, using fallback path:', (e as Error)?.message || String(e));
                cliPath = path.join(process.cwd(), 'kuroma', 'cli.py');
              }
            }
            log.info(`[kuroma] platform=${platform} fg=${fg} cli=${cliPath}`);
            structuredLog.emit('process:chroma-invoke', { platform, accountId, item: item.id, fg, cli: cliPath });
            await new Promise<void>((resolve, reject) => {
              const p = spawn(py, [cliPath, '--background', videoPath, '--foreground', fg!, '--output', tmpOut], { stdio: ['ignore', 'pipe', 'pipe'] });
              let errMsg = '';
              p.stdout.on('data', (d) => log.info('[kuroma]', String(d).trim()));
              p.stderr.on('data', (d) => { const s = String(d); errMsg += s; log.warn('[kuroma]', s.trim()); });
              p.on('close', (code) => {
                if (code === 0 && fsn.existsSync(tmpOut)) {
                  try {
                    // Replace original file with chroma result
                    try { fsn.unlinkSync(videoPath); } catch { /* ignore */ }
                    fsn.renameSync(tmpOut, videoPath);
                    try {
                      const st = fsn.statSync(videoPath);
                      log.info(`[kuroma] replaced video size=${st.size} path=${videoPath}`);
                    } catch {}
                    structuredLog.emit('process:chroma-success', { platform, accountId, item: item.id, videoPath, replaced: true });
                  } catch (e) {
                    // Fallback: keep temp as final and update videoPath
                    log.warn('[kuroma] replace failed, keeping chroma output as new file:', (e as Error)?.message || String(e));
                    videoPath = tmpOut;
                    try {
                      const st2 = fsn.statSync(videoPath);
                      log.info(`[kuroma] fallback chroma video size=${st2.size} path=${videoPath}`);
                    } catch {}
                    structuredLog.emit('process:chroma-success', { platform, accountId, item: item.id, videoPath, replaced: false });
                  }
                  return resolve();
                }
                return reject(new Error(`kuroma failed with code ${code}: ${errMsg}`));
              });
              p.on('error', (e) => reject(e));
            });
          } else {
            log.warn(`[${platform}:${accountId}] chroma enabled but no valid foreground found (fg=${fg || 'null'}). Skipping kuroma step.`);
            structuredLog.emit('process:chroma-skip', { platform, accountId, item: item.id, reason: 'no-foreground' });
          }
        }
      } catch (e) {
        log.error(`[${platform}:${accountId}] kuroma step failed:`, (e as Error)?.message || String(e));
        structuredLog.emit('process:chroma-fail', { platform, accountId, item: item.id, error: (e as Error)?.message || String(e) });
        // Continue with base videoPath
      }
      log.info(`[${platform}:${accountId}] Video generation successful: ${videoPath}`);
      phase('success', { videoPath });
      
      // 【追加】X(Twitter)の場合、スクレイピングされたPNGファイルと同じディレクトリにMP4をコピー
      // これにより、scraper.ts での MP4-PNG 関連付けが正しく機能する
      if (platform === 'x' && videoPath && fsn.existsSync(videoPath) && item.path) {
        try {
          const pngDir = path.dirname(item.path);
          const pngBase = path.basename(item.path, '.png');
          const targetMp4 = path.join(pngDir, `${pngBase}.copy.mp4`); // distinguish derivative
          fsn.copyFileSync(videoPath, targetMp4);
          log.info(`[${platform}:${accountId}] Copied MP4 (derivative) for association-safe use: ${videoPath} -> ${targetMp4}`);
          phase('mp4-copy', { source: videoPath, target: targetMp4, derivative: true });
        } catch (copyErr) {
          log.warn(`[${platform}:${accountId}] Failed to copy MP4 derivative: ${(copyErr as Error).message || String(copyErr)}`);
        }
      }
      
      // 直近処理済みに登録（TTL内の重複抑止）
      this.markRecentlyProcessed(platform, accountId, item.id);
    } catch (e) {
      const err = e as Error;
      phase('error', { message: err.message });
      // Xでの生成失敗時、最終リトライとしてスクレイプ→生成を一度だけ試す
      if (platform === 'x') {
        try {
          log.warn(`[${platform}:${accountId}] Video generation failed. Retrying once with fresh screenshot... Reason: ${err.message || String(err)}`);
          const sr = await scrapeAccount(platform, accountId, (this.store as unknown as { store: AppSettings }).store);
          if (!sr || sr.type !== 'screenshot') throw err;
          // Apply template again to a fresh clone (in case settings changed)
          const baseSettings2: AppSettings = (this.store as unknown as { store: AppSettings }).store;
          const cloned2: AppSettings = JSON.parse(JSON.stringify(baseSettings2));
          try {
            const tpl2 = resolveTemplateFor(platform, accountId, cloned2.templates?.selection, cloned2.templates?.items || {});
            if (tpl2) applyTemplateToSettings(cloned2, tpl2);
          } catch { /* ignore */ }
          phase('retry-generate-start');
          videoPath = await generateVideo(sr.path, cloned2);
          phase('retry-generate-done');
          log.info(`[${platform}:${accountId}] Video generation successful after retry: ${videoPath}`);
          this.markRecentlyProcessed(platform, accountId, item.id);
          return;
        } catch (e2) {
          throw e2;
        }
      }
      throw err;
    } finally {
      this.inFlight.delete(key);
      phase('finish');
    }
  }

  private isRecentlyProcessed(platform: Platform, accountId: string, id: string): boolean {
    const now = Date.now();
    const key = `${platform}:${accountId}:${id}`;
    const ts = this.recentlyProcessed.get(key) || 0;
    if (ts && now - ts < this.RECENT_TTL_MS) {
      structuredLog.emit('monitor:skip-recent', { platform, accountId, id, ageMs: now - ts, ttlMs: this.RECENT_TTL_MS });
      return true;
    }
    if (ts && now - ts >= this.RECENT_TTL_MS) this.recentlyProcessed.delete(key);
    return false;
  }

  private markRecentlyProcessed(platform: Platform, accountId: string, id: string): void {
    const key = `${platform}:${accountId}:${id}`;
    this.recentlyProcessed.set(key, Date.now());
    structuredLog.emit('monitor:mark-processed', { platform, accountId, id, ttlMs: this.RECENT_TTL_MS });
  }
}