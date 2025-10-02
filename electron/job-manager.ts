import PQueue from 'p-queue';
import pRetry from 'p-retry';
import Store from 'electron-store';
import log from 'electron-log';
import type { AppSettings, Platform, Account } from '../src/core/settings';
import { scrapeAccount, ScrapeResult, listRecentItems } from './tasks/scraper';
import { generateVideo } from './tasks/video-generator';
import { downloadVideoToTemp } from './tasks/downloader';
import { captureTweetScreenshotAndBox, overlayVideoOnScreenshot } from './tasks/x-composer';
import { downloadHlsToTemp } from './tasks/downloader';
import path from 'node:path';
import fs from 'node:fs/promises';

type JobStatus = 'idle' | 'running' | 'stopped';

interface PlatformJobManagerState {
  status: JobStatus;
  consecutiveFails: number;
  processedCount: number;
  startTime: number;
  timer?: NodeJS.Timeout;
}

interface JobState {
  isRunning: boolean;
  platforms: Record<Platform, PlatformJobManagerState>;
}

export class JobManager {
  private store: Store<AppSettings & { jobState?: JobState }>;
  private globalQueue: PQueue;
  private jobs: Map<Platform, PlatformJobManagerState & { timer?: NodeJS.Timeout }> = new Map();
  private isRunning = false;
  private inFlight = new Set<string>();
  private recentlyProcessed = new Map<string, number>();
  private readonly RECENT_TTL_MS = 10 * 60 * 1000; // 10 minutes

  constructor(store: Store<AppSettings & { jobState?: JobState }>) {
    this.store = store as any;
    this.globalQueue = new PQueue({ concurrency: 1 });

    const savedJobState = (this.store as unknown as { get: (k: string, d: any) => JobState }).get('jobState', { isRunning: false, platforms: {} as Record<Platform, PlatformJobManagerState> });
    const supported = new Set<Platform>(['x', 'tiktok', 'youtube'] as Platform[]);
    let removedUnsupported = false;
    // Initialize jobs from saved state, sanitize unsupported
    for (const key of Object.keys(savedJobState.platforms || {})) {
      if (!supported.has(key as Platform)) {
        delete (savedJobState.platforms as any)[key];
        removedUnsupported = true;
      }
    }
    for (const platform of supported) {
      const savedPlatformState = savedJobState.platforms?.[platform];
      if (savedPlatformState) {
        this.jobs.set(platform, { ...savedPlatformState, status: 'stopped', timer: undefined });
        if (savedPlatformState.status === 'running') {
          log.info(`Previous job for ${platform} was running. Will restart on app start.`);
        }
      }
    }
    if (removedUnsupported) {
      try {
        (this.store as unknown as { set: (k: string, v: unknown) => void }).set('jobState', savedJobState);
        log.info('[migrate] Removed unsupported platforms from jobState during JobManager init');
      } catch { /* ignore */ }
    }
    this.isRunning = false; // always start stopped
    log.info(`JobManager initialized. isRunning: ${this.isRunning}`);
  }

  private getJobStateForPersistence(): JobState {
    const platformsState: Record<Platform, PlatformJobManagerState> = {} as Record<Platform, PlatformJobManagerState>;
    for (const [platform, job] of this.jobs.entries()) {
      platformsState[platform] = {
        status: job.status,
        consecutiveFails: job.consecutiveFails,
        processedCount: job.processedCount,
        startTime: job.startTime,
      };
    }
    return {
      isRunning: this.isRunning,
      platforms: platformsState,
    };
  }

  private saveJobState() {
    (this.store as unknown as { set: (k: string, v: unknown) => void }).set('jobState', this.getJobStateForPersistence());
  }

  public start() {
    if (this.isRunning) {
      log.info('JobManager is already running.');
      return;
    }
    this.isRunning = true;
    this.saveJobState(); // Save state on start
    log.info('JobManager started.');

  const settings = (this.store as unknown as { store: AppSettings }).store;
    for (const key in settings.platforms) {
      const platform = key as Platform;
      const platformSettings = settings.platforms[platform];
      if (platformSettings.enabled) {
        this.startPlatformJob(platform);
      }
    }
  }

  public stop() {
    if (!this.isRunning) {
      log.info('JobManager is not running.');
      return;
    }
    this.isRunning = false;
    this.saveJobState(); // Save state on stop
    log.info('JobManager stopping all platform jobs.');
    for (const platform of this.jobs.keys()) {
      this.stopPlatformJob(platform);
    }
  }

  private startPlatformJob(platform: Platform) {
  const platformSettings = (this.store as unknown as { store: AppSettings }).store.platforms[platform];
    if (!platformSettings || !platformSettings.enabled) {
      return;
    }

    let job = this.jobs.get(platform);
    if (job && job.status === 'running') {
      log.info(`Job for platform ${platform} is already running.`);
      return;
    }
    
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

  // すべての有効なプラットフォーム・有効アカウントで最新1件テスト処理を一括実行
  public async runTestOnceAll(): Promise<{ totalAccounts: number; attempted: number; processed: number; }>{
    // 仕様: 各プラットフォーム（有効アカウント）で最新3件ずつを重複許可で処理
    const summary = await this.runTestLatestNAll(3);
    return summary;
  }

  // 仕様対応: 各アカウントで最新N件を重複許可で処理（状態は更新しない）
  public async runTestLatestNAll(n: number): Promise<{ totalAccounts: number; attempted: number; processed: number; }>{
    const settings: AppSettings = (this.store as unknown as { store: AppSettings }).store;
    const supported = new Set<Platform>(['x','tiktok','youtube'] as Platform[]);
    const accounts: Array<{ platform: Platform; id: string }>= [];
    for (const platformKey of Object.keys(settings.platforms) as Platform[]) {
      if (!supported.has(platformKey)) continue;
      const ps = settings.platforms[platformKey];
      if (!ps.enabled) continue;
      for (const acct of ps.accounts) {
        if (!acct?.isActive) continue;
        const id = (acct.id || '').trim();
        if (!id) continue;
        accounts.push({ platform: platformKey, id });
      }
    }

    const attempted = accounts.length * Math.max(0, n);
    let processed = 0;
    // 各アカウントで最新N件を取得（sinceCursorは無視して重複許可）
    for (const { platform, id } of accounts) {
      try {
        const items = await listRecentItems(platform, id, n, undefined);
        // 重複許可: processedIds/最近処理済みは見ない。順番に処理。
        for (const item of items) {
          try {
            await this.globalQueue.add(() => this.processItem(platform, id, item));
            processed += 1;
          } catch { /* 個別失敗はスキップ */ }
        }
      } catch { /* アカウント単位の失敗は継続 */ }
    }
    return { totalAccounts: accounts.length, attempted, processed };
  }

  // 新規: 指定プラットフォームの有効アカウントで最新N件を重複許可で処理（状態は更新しない）
  public async runTestLatestNPlatform(platform: Platform, n: number): Promise<{ totalAccounts: number; attempted: number; processed: number; }>{
    const settings: AppSettings = (this.store as unknown as { store: AppSettings }).store;
    const ps = settings.platforms[platform];
    if (!ps || !ps.enabled) {
      return { totalAccounts: 0, attempted: 0, processed: 0 };
    }
    const accounts = (ps.accounts || []).filter(a => a?.isActive && (a.id || '').trim()).map(a => (a.id || '').trim());
    const attempted = accounts.length * Math.max(0, n);
    let processed = 0;
    for (const id of accounts) {
      try {
        let items = await listRecentItems(platform, id, n, undefined);
        // Heuristic: for X, prioritize items with video classification to exercise overlay path
        if (platform === 'x') {
          const score = (c?: string) => {
            const s = String(c || '').toLowerCase();
            if (s.includes('single_video')) return 2;
            if (s.includes('multi_video') || s.includes('video')) return 1;
            return 0;
          };
          items = [...items].sort((a, b) => score(b.classification) - score(a.classification));
        }
        for (const item of items) {
          try {
            await this.globalQueue.add(() => this.processItem(platform, id, item));
            processed += 1;
          } catch { /* 個別失敗は継続 */ }
        }
      } catch { /* アカウント単位失敗は継続 */ }
    }
    return { totalAccounts: accounts.length, attempted, processed };
  }

  private async processItem(platform: Platform, accountId: string, item: { id: string; type: 'screenshot'|'video_url'; url?: string; path?: string; classification?: string }) {
    // スクレイピング済みアイテムから動画生成実行
    const key = `${platform}:${accountId}:${item.id}`;
    if (this.inFlight.has(key)) {
      log.info(`[dup-guard] Skip processing already in-flight: ${key}`);
      return;
    }
    this.inFlight.add(key);
    let videoPath = '';
    try {
    if (item.type === 'screenshot') {
      // X のスクショ項目に URL が付与されている場合、まず動画ダウンロードを試行（動画付きポストならこちらを優先）
      if (platform === 'x') {
        // 1) まずキャプチャして記事矩形と外部リンク候補を取得
        const handle = (accountId || '').replace(/^@/, '');
        const tweetUrl = item.url || (/^\d+$/.test(item.id || '') ? `https://x.com/${handle}/status/${item.id}` : undefined);
        const shotOut = path.join((this.store as unknown as { store: AppSettings }).store.general.outputPath || process.cwd(), 'x-composed');
        let cap = null as Awaited<ReturnType<typeof captureTweetScreenshotAndBox>> | null;
        try {
          if (tweetUrl) cap = await captureTweetScreenshotAndBox(tweetUrl, shotOut);
        } catch (e) {
          log.warn(`[${platform}:${accountId}] captureTweetScreenshotAndBox failed: ${(e as Error)?.message || String(e)}`);
        }
        // 2) ダウンロード候補（tweetUrl, externalUrl）を順に試す
        let dlOk: { filepath: string } | null = null;
  const candidates: string[] = [];
        if (tweetUrl) candidates.push(tweetUrl);
  if (cap?.externalUrl) candidates.push(cap.externalUrl);
  if ((cap as any)?.hlsHint) candidates.push((cap as any).hlsHint);
        for (const u of candidates) {
          try {
            log.info(`[${platform}:${accountId}] Trying download for overlay: ${u}`);
            // HLS 直リンク（video.twimg.com などの m3u8）は ffmpeg フォールバックで取得
            if (/\.m3u8($|\?)/.test(u) || /video\.twimg\.com/.test(u)) {
              const hls = await downloadHlsToTemp(u);
              dlOk = hls; break;
            }
            const dl = await downloadVideoToTemp(u, /youtube\.com|youtu\.be/.test(u) ? 'youtube' as any : platform);
            dlOk = dl; break;
          } catch (e) {
            log.warn(`[${platform}:${accountId}] Download try failed for ${u}: ${(e as Error)?.message || String(e)}`);
          }
        }
        // 3) relBox と 動画が揃えばオーバーレイ、無ければフォールバック
        if (cap && cap.relBox && dlOk) {
          // まずスクショ上に動画をはめ込み（中間ファイル）
          const composed = await overlayVideoOnScreenshot({
            screenshotPath: cap.screenshotPath,
            videoPath: dlOk.filepath,
            box: cap.relBox,
            outputDir: shotOut,
            fileName: `x-compose-${accountId}-${cap.tweetId || item.id}-${Date.now()}.mp4`,
          });
          log.info(`[${platform}:${accountId}] Composited onto screenshot (captureapp path).`);
          // 仕様: その後、背景合成/クロマ適用を行い、指定フォルダ（outputPath）へ最終出力
          videoPath = await generateVideo('', (this.store as unknown as { store: AppSettings }).store, composed, { accountId: { platform, id: accountId }, sourceType: 'x_tweet_overlay' as any });
          try {
            if (process.env.ENABLE_META_JSON === '1') {
              const metaPath = composed.replace(/\.mp4$/i, '.meta.json');
              const meta = {
                sourceType: 'x_tweet_overlay',
                platform,
                accountId,
                tweetId: cap.tweetId || item.id,
                url: tweetUrl,
                classification: cap.classification || item.classification || 'unknown',
                relBox: cap.relBox,
                screenshotPath: cap.screenshotPath,
                tweetVideoPath: dlOk.filepath,
                composedPath: composed,
                overlayDiagnostics: { dpr: (cap as any)?.dpr || null, ...(cap as any)?.diag },
                finalOutputPath: videoPath,
                ts: new Date().toISOString(),
              } as const;
              await fs.writeFile(metaPath, JSON.stringify(meta, null, 2), 'utf8');
            }
          } catch { /* ignore */ }
        } else if (dlOk) {
          videoPath = await generateVideo('', (this.store as unknown as { store: AppSettings }).store, dlOk.filepath, { accountId: { platform, id: accountId }, sourceType: 'x_tweet_video' });
          log.info(`[${platform}:${accountId}] Used downloaded video as source (fallback vertical compose).`);
        }
      }
      // まだ videoPath が未決定なら、従来通りスクショ合成へ
      if (!videoPath) {
        if (!item.path) {
          // 互換: 以前の1件スクレイプフローにフォールバック
          const scrapeResult = await scrapeAccount(platform, accountId, (this.store as unknown as { store: AppSettings }).store);
          if (!scrapeResult) throw new Error('Scraping did not return a result.');
          if (scrapeResult.type !== 'screenshot') throw new Error('Expected screenshot item.');
          const shotPath = scrapeResult.path;
          videoPath = await generateVideo(shotPath, (this.store as unknown as { store: AppSettings }).store, undefined, { accountId: { platform, id: accountId } });
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
            const sr = await scrapeAccount(platform, accountId, (this.store as unknown as { store: AppSettings }).store);
            if (sr && sr.type === 'screenshot') {
              shot = sr.path;
            } else {
              throw new Error('Failed to refetch screenshot');
            }
          }
          videoPath = await generateVideo(shot, (this.store as unknown as { store: AppSettings }).store, undefined, { accountId: { platform, id: accountId }, sourceType: 'screenshot' });
        }
      }
    } else if (item.type === 'video_url') {
      const url = item.url || '';
      // First download the video to a local temp file, then feed to ffmpeg
    const dl = await downloadVideoToTemp(url, platform);
  videoPath = await generateVideo('', (this.store as unknown as { store: AppSettings }).store, dl.filepath, { accountId: { platform, id: accountId }, sourceType: platform === 'youtube' ? 'youtube' : (platform === 'tiktok' ? 'tiktok' : 'other') });
    } else {
      throw new Error(`Unknown item type: ${item.type}`);
    }
    log.info(`[${platform}:${accountId}] Video generation successful: ${videoPath}`);
      // 直近処理済みに登録（TTL内の重複抑止）
      this.markRecentlyProcessed(platform, accountId, item.id);
    } catch (e) {
      const err = e as Error;
      // Xでの生成失敗時、最終リトライとしてスクレイプ→生成を一度だけ試す
      if (platform === 'x') {
        try {
          log.warn(`[${platform}:${accountId}] Video generation failed. Retrying once with fresh screenshot... Reason: ${err.message || String(err)}`);
          const sr = await scrapeAccount(platform, accountId, (this.store as unknown as { store: AppSettings }).store);
          if (!sr || sr.type !== 'screenshot') throw err;
          videoPath = await generateVideo(sr.path, (this.store as unknown as { store: AppSettings }).store, undefined, { accountId: { platform, id: accountId }, sourceType: 'screenshot' });
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
    }
  }

  private isRecentlyProcessed(platform: Platform, accountId: string, id: string): boolean {
    const now = Date.now();
    const key = `${platform}:${accountId}:${id}`;
    const ts = this.recentlyProcessed.get(key) || 0;
    if (ts && now - ts < this.RECENT_TTL_MS) return true;
    if (ts && now - ts >= this.RECENT_TTL_MS) this.recentlyProcessed.delete(key);
    return false;
  }

  private markRecentlyProcessed(platform: Platform, accountId: string, id: string): void {
    const key = `${platform}:${accountId}:${id}`;
    this.recentlyProcessed.set(key, Date.now());
  }
}

export default JobManager;
