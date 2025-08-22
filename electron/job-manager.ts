import PQueue from 'p-queue';
import pRetry from 'p-retry';
import Store from 'electron-store';
import log from 'electron-log';
import type { AppSettings, Platform, Account } from '../src/core/settings.js';
import { scrapeAccount, ScrapeResult, listRecentItems } from './tasks/scraper.js';
import { generateVideo } from './tasks/video-generator.js';

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

export class JobManager {
  private store: Store<AppSettings>;
  private jobs: Map<Platform, PlatformJobManager>;
  private isRunning: boolean = false; // This will be loaded from store
  private globalQueue: PQueue;

  constructor(store: Store<AppSettings>) {
    this.store = store;
    this.jobs = new Map();
    this.globalQueue = new PQueue({ concurrency: 5 });

    // Load previous job state
  const savedJobState = (this.store as unknown as { get: (k: string, d: JobState) => JobState }).get('jobState', { isRunning: false, platforms: {} as Record<Platform, PlatformJobManagerState> });
    this.isRunning = savedJobState.isRunning || false;

    if (savedJobState.platforms) {
      for (const platformKey in savedJobState.platforms) {
        const platform = platformKey as Platform;
        const savedPlatformState = savedJobState.platforms[platform];
        // Only restore if it was running, otherwise treat as idle
  // 前回 running だったジョブは、起動後に再開するため idle として復元し、start() 時に有効化
  const status = savedPlatformState.status === 'running' ? 'idle' : savedPlatformState.status;
        this.jobs.set(platform, {
          status: status,
          consecutiveFails: savedPlatformState.consecutiveFails,
          processedCount: savedPlatformState.processedCount,
          startTime: savedPlatformState.startTime,
          // timer will be set when job actually starts
        });
        if (savedPlatformState.status === 'running') { // If it was running, log that it needs to be restarted
          log.info(`Previous job for ${platform} was running. Will restart on app start.`);
        }
      }
    }
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
  const items = await listRecentItems(platform, accountId, backfillCount, acct?.lastCursor);
        log.info(`[${platform}:${accountId}] Backfill ${items.length} item(s).`);
        for (const item of items) {
          await this.processItem(platform, accountId, item);
          // カーソル更新（最後に処理したID）
          (this.store as unknown as { set: (k: string, v: unknown) => void }).set(`platforms.${platform}.accounts`, settings.platforms[platform].accounts.map(a => a.id === accountId ? { ...a, lastCursor: item.id } : a));
        }
        // 残数を0に
  (this.store as unknown as { set: (k: string, v: unknown) => void }).set(`platforms.${platform}.accounts`, settings.platforms[platform].accounts.map(a => a.id === accountId ? { ...a, backfillRemaining: 0 } : a));
        log.info(`[${platform}:${accountId}] Backfill completed.`);
      } else {
        // 通常運用：新規のみ（lastCursor より新しい最新1件を対象）
        const items = await listRecentItems(platform, accountId, 1, acct?.lastCursor);
        if (items.length > 0) {
          const item = items[0];
          await this.processItem(platform, accountId, item);
          (this.store as unknown as { set: (k: string, v: unknown) => void }).set(`platforms.${platform}.accounts`, settings.platforms[platform].accounts.map(a => a.id === accountId ? { ...a, lastCursor: item.id } : a));
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

  private async processItem(platform: Platform, accountId: string, item: { id: string; type: 'screenshot'|'video_url'; url?: string; path?: string }) {
    // スクレイピング済みアイテムから動画生成実行
    let videoPath = '';
    if (item.type === 'screenshot') {
      if (!item.path) {
        // 互換: 以前の1件スクレイプフローにフォールバック
        const scrapeResult = await scrapeAccount(platform, accountId, (this.store as unknown as { store: AppSettings }).store);
        if (!scrapeResult) throw new Error('Scraping did not return a result.');
        if (scrapeResult.type !== 'screenshot') throw new Error('Expected screenshot item.');
  videoPath = await generateVideo(scrapeResult.path, (this.store as unknown as { store: AppSettings }).store);
      } else {
  videoPath = await generateVideo(item.path, (this.store as unknown as { store: AppSettings }).store);
      }
    } else if (item.type === 'video_url') {
      const url = item.url || '';
  videoPath = await generateVideo('', (this.store as unknown as { store: AppSettings }).store, url);
    } else {
      throw new Error(`Unknown item type: ${item.type}`);
    }
    log.info(`[${platform}:${accountId}] Video generation successful: ${videoPath}`);
  }
}
