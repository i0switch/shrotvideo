import log from 'electron-log';
import type { AppSettings, Platform } from '../../src/core/settings';
import { app, BrowserWindow } from 'electron';
import path from 'path';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import * as keytar from 'keytar';
import os from 'node:os';
import { restoreCookies } from '../auth-utils';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import ffmpegStatic from 'ffmpeg-static';
const execFileAsync = promisify(execFile);

// Fixed absolute screenshot root (requested): all X screenshot I/O will use only this directory
// Note: Proper Windows absolute path with drive letter and escaped backslashes
const SCREENSHOT_ROOT = 'C:\\Users\\i0swi\\OneDrive\\デスクトップ\\dougadownload\\screenshot';

// Helper: get a ready-to-use YtDlp client (ensures binary + ffmpeg configured)
export async function getYtdlpClient(): Promise<{ yt: any, binPath?: string }> {
  const mod = await import('ytdlp-nodejs');
  // CJS default export contains named exports
  const YtDlp = (mod as any).YtDlp || (mod as any).default?.YtDlp;
  const helpers = (mod as any).helpers || (mod as any).default?.helpers;
  if (!YtDlp || !helpers) throw new Error('ytdlp-nodejs exports not found');
  try {
    // Ensure yt-dlp binary exists (silent if already present)
    const bin = helpers.findYtdlpBinary?.();
    if (!bin) {
      await helpers.downloadYtDlp?.(helpers.BIN_DIR);
    }
  } catch { /* ignore; YtDlp will still try */ }
  // app.asar.unpack 側にある ffmpeg/yt-dlp を優先
  const resolvePacked = (p?: string) => {
    if (!p) return p;
    let f = p;
    if (f.includes('app.asar\\')) f = f.replace('app.asar\\', 'app.asar.unpacked\\');
    if (f.includes('app.asar/')) f = f.replace('app.asar/', 'app.asar.unpacked/');
    return f;
  };
  const yt = new YtDlp({ ffmpegPath: resolvePacked(ffmpegStatic as unknown as string) || ffmpegStatic || undefined });
  const found = (helpers.findYtdlpBinary?.() as string | undefined) || undefined;
  const binPath = resolvePacked(found) || found;
  return { yt, binPath };
}

// Helper: Probe if a YouTube URL is a playable Short (public/unlisted and duration <= ~61s)
async function isYouTubeShortPlayable(url: string, cookieFile?: string): Promise<boolean> {
  try {
    const { binPath } = await getYtdlpClient();
    const bin = binPath || 'yt-dlp';
    const args = [
      url,
      '-J',
      '--no-warnings',
      '--yes-playlist',
      '--impersonate', 'chrome',
    ];
    if (cookieFile) {
      args.push('--cookies', cookieFile);
    }
  const { stdout } = await execFileAsync(bin, args, { timeout: 60000, windowsHide: true });
    const data: any = JSON.parse(stdout);
    const pageUrl: string = data?.webpage_url || url;
    const dur = (data?.duration || 0) as number;
    const avail = String(data?.availability || '').toLowerCase();
    const isAllowedAvail = !avail || avail === 'public' || avail === 'unlisted';
    const isShortsUrl = /https?:\/\/(www\.)?youtube\.com\/shorts\//.test(pageUrl);
    const isBeShort = /https?:\/\/(www\.)?youtu\.be\//.test(pageUrl) && dur <= 61;
    const isWatchShort = /https?:\/\/(www\.)?youtube\.com\/watch\?v=/.test(pageUrl) && dur <= 61;
    return !!(isAllowedAvail && (isShortsUrl || isBeShort || isWatchShort));
  } catch (e) {
    log.info(`[yt-probe] URL not playable as Short (or probe failed): ${url}. Reason: ${(e as Error)?.message || String(e)}`);
    return false;
  }
}

export type ScrapeResult = { type: 'screenshot', path: string } | { type: 'video_url', url: string };

function getPlatformUrl(platform: Platform, accountId: string): string {
  switch (platform) {
    case 'x':
      return `https://x.com/${accountId}`;
    case 'tiktok':
      return `https://www.tiktok.com/@${accountId}`;
    case 'youtube':
  // 仕様変更: YouTube はチャンネルの Shorts のみ対象
  // Shorts タブに限定して最新アイテムを取得する
  return `https://www.youtube.com/@${accountId}/shorts`;
    default:
      throw new Error(`Unsupported platform: ${platform}`);
  }
}

// Create a temporary Netscape-format cookie file from saved cookies for platforms that benefit from login
async function createCookieFileIfAny(platform: Platform): Promise<string | undefined> {
  if (platform !== 'youtube' && platform !== 'tiktok') return undefined;
  try {
    const raw = await keytar.getPassword(APP, platform);
    if (!raw) {
      log.info(`[scraper:${platform}] No raw credentials found in keystore.`);
      return undefined;
    }
    const cookies = JSON.parse(raw) as Electron.Cookie[];
    if (!Array.isArray(cookies) || cookies.length === 0) {
      log.info(`[scraper:${platform}] No cookies found for platform.`);
      return undefined;
    }
    const toNetscape = (list: Electron.Cookie[]) => {
      let s = '# Netscape HTTP Cookie File\n';
      for (const c of list) {
        try {
          const domain = (c.domain || '').trim();
          const pathv = (c.path || '/').trim();
          const includeSub = domain.startsWith('.') ? 'TRUE' : 'FALSE';
          const secure = c.secure ? 'TRUE' : 'FALSE';
          const exp = c.expirationDate ? Math.round(c.expirationDate) : 0;
          const name = c.name ?? '';
          const value = c.value ?? '';
          s += [domain, includeSub, pathv, secure, exp, name, value].join('\t') + '\n';
        } catch { /* ignore malformed cookie */ }
      }
      return s;
    };
    const p = path.join(os.tmpdir(), `cookies-${platform}-${Date.now()}.txt`);
    const cookieContent = toNetscape(cookies);
    await fs.writeFile(p, cookieContent);
    log.info(`[scraper:${platform}] Created cookie file at ${p}`);
    log.info(`[scraper:${platform}] DEBUG: Cookie file content (first 200 chars):\n${cookieContent.substring(0, 200)}`);
    return p;
  } catch (e) {
    log.error(`[scraper:${platform}] Failed to create cookie file.`, e);
    return undefined;
  }
}

// Helper: run screenshot backend using direct capture for better video handling
async function runScreenshotGrab(user: string, count: number): Promise<void> {
  log.info(`[scraper:runScreenshotGrab] Starting capture for user=${user} count=${count}`);
  
  // For now, we'll fallback to the spawn method but with optimized settings for video capture
  // In the future, this should use direct capture module with proper X account enumeration
  
  const appPath = app.getAppPath();
  const candCwd = path.join(process.cwd(), 'screenshot', 'bin', 'grab.cjs');
  const candApp = path.join(appPath, 'screenshot', 'bin', 'grab.cjs');
  const script = existsSync(candCwd) ? candCwd : candApp;
  const outBase = path.join(SCREENSHOT_ROOT, 'out', 'screenshots');
  try { await fs.mkdir(outBase, { recursive: true }); } catch { /* ignore */ }
  
  await new Promise<void>((resolve) => {
    // Enhanced environment for video capture (remove ELECTRON_RUN_AS_NODE to preserve video playback capabilities)
    const env = { 
      ...process.env, 
      // ELECTRON_RUN_AS_NODE: '1',  // Removed to preserve video playback in Node.js process
      PLAYWRIGHT_BROWSERS_PATH: '0',
      // Add video-specific settings
      FORCE_VIDEO_CAPTURE: '1',
      VIDEO_PROCESSING_PRIORITY: '1',
      CHROMIUM_AUTOPLAY_POLICY: 'no-user-gesture-required'
    } as NodeJS.ProcessEnv;
    
    let stderr = '';
    try {
      log.info(`[screenshot:grab] spawn: exe=${process.execPath} script=${script} user=${user} count=${count} out=${outBase}`);
      
      // Use Node.js directly instead of Electron process to avoid video playback restrictions
      const nodeExe = process.platform === 'win32' ? 'node.exe' : 'node';
      const child = spawn(nodeExe, [script, '--user', user, '--count', String(Math.max(1, count)), '--outDir', outBase, '--fps', '16'], { 
        env, 
        stdio: ['ignore', 'pipe', 'pipe'],
        cwd: path.dirname(script) // Ensure proper working directory
      });
      
      child.stderr?.on('data', (d) => { stderr += d?.toString?.() || ''; });
      child.stdout?.on('data', (d) => { const s = d?.toString?.(); if (s) log.info('[screenshot:grab:out]', s.trim()); });
      child.on('close', (code) => {
        if (code !== 0) {
          log.warn(`[screenshot:grab] exited with code ${code}. stderr: ${stderr?.slice?.(0, 4000)}`);
        }
        log.info(`[screenshot:grab] completed for user=${user} with code=${code}`);
        resolve();
      });
      child.on('error', (error) => {
        log.error(`[screenshot:grab] spawn error:`, error);
        resolve();
      });
    } catch (error) {
      log.error(`[screenshot:grab] catch error:`, error);
      resolve();
    }
  });
}

export async function scrapeX(accountId: string): Promise<string | null> {
  // Force using screenshot subapp runner only
  const acctSan = accountId.startsWith('@') ? accountId.substring(1) : accountId;
  const userOutDir = path.join(SCREENSHOT_ROOT, 'out', 'screenshots', acctSan);
  try { await fs.mkdir(userOutDir, { recursive: true }); } catch { /* ignore */ }
  try {
    await runScreenshotGrab(acctSan, 1);
  } catch (e) {
    log.error(`[x:${accountId}] screenshot backend grab failed:`, (e as Error)?.message || String(e));
  }
  try {
    const names = await fs.readdir(userOutDir);
    const pngs = names.filter(n => n.toLowerCase().endsWith('.png'));
    if (!pngs.length) return null;
    // pick newest by mtime
    let newest: { name: string; mtime: number } | null = null;
    for (const n of pngs) {
      try {
        const s = await fs.stat(path.join(userOutDir, n));
        const mt = s.mtimeMs || (s as any).mtime?.getTime?.() || 0;
        if (!newest || mt > newest.mtime) newest = { name: n, mtime: mt };
      } catch { /* ignore */ }
    }
    return newest ? path.join(userOutDir, newest.name) : null;
  } catch { return null; }
}

export async function scrapeAccount(
  platform: Platform,
  accountId: string,
  settings: AppSettings,
): Promise<ScrapeResult | null> {
  log.info(`[${platform}:${accountId}] Starting scrape...`);

  if (platform === 'tiktok' || platform === 'youtube') {
    const accountUrl = getPlatformUrl(platform, accountId);
    try {
      const cookieFile = await createCookieFileIfAny(platform);
      log.info(`[${platform}:${accountId}] Using ytdlp-nodejs to get latest item from ${accountUrl}`);
      const { yt, binPath } = await getYtdlpClient();
      const baseOpts = {
        flatPlaylist: true,
        playlistEnd: 1,
        skipDownload: true,
        noCheckCertificates: true,
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36',
        ...(cookieFile ? { cookies: cookieFile } : {}),
      } as const;
      // Try module first
      try {
        // Shortsから複数取得して、公開Shortsのみを選別
        const info: any = await yt.getInfoAsync(accountUrl, { ...baseOpts, playlistEnd: 5 } as any);
        const entriesList: any[] = Array.isArray(info?.entries) ? info.entries : [info];
        let pageUrl = '' as string;
        let chosen: any = null;
        for (const entry of entriesList) {
          let u = (entry?.webpage_url || entry?.original_url || entry?.url || '') as string;
          if (platform === 'youtube') {
            const vid = (entry?.id as string | undefined) && (entry.id as string).length === 11 ? (entry.id as string) : undefined;
            if (!/https?:\/\/(www\.)?youtube\.com\/watch\?v=/.test(u)
              && !/https?:\/\/(www\.)?youtube\.com\/shorts\//.test(u)
              && !/https?:\/\/(www\.)?youtu\.be\//.test(u)
              && vid) {
              u = `https://www.youtube.com/watch?v=${vid}`;
            }
            const dur = (entry?.duration as number) || 0;
            const avail = String(entry?.availability || '').toLowerCase();
            const isAllowedAvail = !avail || avail === 'public' || avail === 'unlisted';
            const isShortsUrl = /https?:\/\/(www\.)?youtube\.com\/shorts\//.test(u);
            const isBeShort = /https?:\/\/(www\.)?youtu\.be\//.test(u) && dur <= 61;
            const isWatchShort = /https?:\/\/(www\.)?youtube\.com\/watch\?v=/.test(u) && dur <= 61;
            if (isAllowedAvail && (isShortsUrl || isBeShort || isWatchShort)) {
              const playable = await isYouTubeShortPlayable(u, cookieFile);
              if (!playable) {
                log.info(`[${platform}:${accountId}] Skipping not-playable Short candidate (module): ${u}`);
                continue;
              }
              pageUrl = u;
              chosen = entry;
              break;
            }
          } else {
            pageUrl = u;
            chosen = entry;
            break;
          }
        }
        if (platform === 'youtube') {
          // ここまでで pageUrl は公開Shortsのはず
        }
        if (pageUrl) {
          log.info(`[${platform}:${accountId}] Found: ${pageUrl}`);
          return { type: 'video_url', url: pageUrl };
        }
        log.warn(`[${platform}:${accountId}] yt-dlp module returned no usable URL; will fallback.`);
      } catch (modErr) {
        log.warn(`[${platform}:${accountId}] yt-dlp module error: ${(modErr as Error).message}`);
      }

      // CLI fallback with resolved binary path
      try {
        const bin = binPath || 'yt-dlp';
  const args = ['-J', accountUrl, '--flat-playlist', '--playlist-end', '1'];
  if (cookieFile) { args.push('--cookies', cookieFile); }
        const { stdout } = await execFileAsync(bin, args);
        const data = JSON.parse(stdout);
        const entriesList: any[] = Array.isArray(data?.entries) ? data.entries : [data];
        let pageUrl = '' as string;
        for (const entry of entriesList) {
          let u = (entry?.webpage_url || entry?.original_url || entry?.url || '') as string;
          if (platform === 'youtube') {
            const vid = (entry?.id as string | undefined) && (entry.id as string).length === 11 ? (entry.id as string) : undefined;
            if (!/https?:\/\/(www\.)?youtube\.com\/watch\?v=/.test(u)
              && !/https?:\/\/(www\.)?youtube\.com\/shorts\//.test(u)
              && !/https?:\/\/(www\.)?youtu\.be\//.test(u)
              && vid) {
              u = `https://www.youtube.com/watch?v=${vid}`;
            }
            const dur = (entry?.duration as number) || 0;
            const avail = String(entry?.availability || '').toLowerCase();
            const isAllowedAvail = !avail || avail === 'public' || avail === 'unlisted';
            const isShortsUrl = /https?:\/\/(www\.)?youtube\.com\/shorts\//.test(u);
            const isBeShort = /https?:\/\/(www\.)?youtu\.be\//.test(u) && dur <= 61;
            const isWatchShort = /https?:\/\/(www\.)?youtube\.com\/watch\?v=/.test(u) && dur <= 61;
            if (isAllowedAvail && (isShortsUrl || isBeShort || isWatchShort)) {
              const playable = await isYouTubeShortPlayable(u, cookieFile);
              if (!playable) {
                log.info(`[${platform}:${accountId}] Skipping not-playable Short candidate (CLI): ${u}`);
                continue;
              }
              pageUrl = u;
              break;
            }
          } else {
            pageUrl = u;
            break;
          }
        }
        if (pageUrl) {
          log.info(`[${platform}:${accountId}] Found via CLI: ${pageUrl}`);
          return { type: 'video_url', url: pageUrl };
        }
        log.warn(`[${platform}:${accountId}] yt-dlp CLI returned no usable URL; will fallback.`);
      } catch (cliErr) {
        log.warn(`[${platform}:${accountId}] yt-dlp CLI error: ${(cliErr as Error).message}`);
      }

      return null;
    } catch (error) {
      const e = error as Error & { message?: string };
      log.error(`[${platform}:${accountId}] unexpected error in scrapeAccount: ${e.message || String(error)}`);
      return null;
    }
  }

  if (platform === 'x') {
    const screenshotPath = await scrapeX(accountId);
    if (screenshotPath) {
      return { type: 'screenshot', path: screenshotPath };
    }
    return null;
  }

  return null;
}

// ===== Cookie utils (kept for potential future use) =====
const APP = 'ShortVideoAssistant';

// ===== New: Recent items listing for backfill/new-only mode =====

export type ListedItem = { id: string; type: 'screenshot' | 'video_url'; url?: string; path?: string };

/**
 * List recent items for a platform/account. Ordered newest -> older.
 * sinceCursor: if provided, stop before reaching that id (do not include it).
 */
export async function listRecentItems(platform: Platform, accountId: string, limit: number, sinceCursor?: string): Promise<ListedItem[]> {
  if (limit <= 0) return [];
  if (platform === 'x') {
  // Always use backend-based Playwright runner; disable legacy offscreen capture path
  return await listRecentItemsX_viaBackend(accountId, limit, sinceCursor);
  }
  if (platform === 'tiktok' || platform === 'youtube') {
    return await listRecentItemsViaYtDlpInternal(platform, accountId, limit, sinceCursor);
  }
  return [];
}

// Restored internal implementation wrapper (renamed to avoid missing symbol errors)
async function listRecentItemsViaYtDlpInternal(platform: Exclude<Platform,'x'>, accountId: string, limit: number, sinceCursor?: string): Promise<ListedItem[]> {
  // Minimal fallback: reuse older path by calling scraper (single latest) repeatedly to approximate list
  const out: ListedItem[] = [];
  for (let i=0;i<limit;i++) {
    try {
      const one = await scrapeAccount(platform as any, accountId, ({} as any));
      if (one && one.type === 'video_url') {
        const id = `${Date.now()}-${i}`;
        out.push({ id, type: 'video_url', url: (one as any).url });
      }
    } catch { /* ignore */ }
    if (out.length >= limit) break;
  }
  return out;
}

// New: Force Playwright-based screenshot backend for X in all environments (including packaged EXE)
async function listRecentItemsX_viaBackend(accountId: string, limit: number, sinceCursor?: string): Promise<ListedItem[]> {
  const results: ListedItem[] = [];
  try {
    const acctSan = accountId.startsWith('@') ? accountId.substring(1) : accountId;
    // Run backend grabber for requested limit
    await runScreenshotGrab(acctSan, Math.max(1, limit));
  // 小さな待機: 書き込み完了待ち（稀にgrab直後はディレクトリ一覧に反映されないことがある）
  try { await new Promise(r => setTimeout(r, 700)); } catch { /* ignore */ }
    const userOutDir = path.join(SCREENSHOT_ROOT, 'out', 'screenshots', acctSan);
    const names = await fs.readdir(userOutDir).catch(() => [] as string[]);
    log.info(`[x:${accountId}] listRecentItemsX_viaBackend: dir=${userOutDir} names=${names.length}`);
    const files = await Promise.all(names
      .filter(n => n.toLowerCase().endsWith('.png'))
      .map(async (n) => {
        try {
          const p = path.join(userOutDir, n);
          const s = await fs.stat(p);
          return { name: n, path: p, mtime: s.mtimeMs || (s as any).mtime?.getTime?.() || 0 };
        } catch { return null as any; }
      }));
    const candidateCount = Math.max(limit * 3, limit + 5);
    let sorted = (files.filter(Boolean) as { name: string; path: string; mtime: number }[])
      .sort((a, b) => b.mtime - a.mtime)
      .slice(0, candidateCount);
    log.info(`[x:${accountId}] listRecentItemsX_viaBackend: pngs=${files.filter(Boolean).length} sorted=${sorted.length}`);
    for (const f of sorted) {
      log.info(`[x:${accountId}] candidate: ${path.basename(f.path)} mtime=${new Date(f.mtime).toISOString()}`);
    }

    // フォールバック1: 取得数が不足する場合、インラインPlaywrightで直接キャプチャ（main.tsのauto-capture相当）
    if (sorted.length < Math.max(1, limit)) {
      try {
        log.warn(`[x:${accountId}] PNG不足(${sorted.length}/${limit}). Trying inline Playwright fallback...`);
        // Prefer full playwright (bundled in devDeps). If not present, this require will throw.
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { chromium } = require('playwright');
        const storageStatePath = path.join(SCREENSHOT_ROOT, '.auth', 'x.storage.json');
        const browser = await (chromium as any).launch({ headless: true });
        const context = await browser.newContext({
          storageState: storageStatePath,
          viewport: { width: 1280, height: 800 },
          deviceScaleFactor: 1,
          locale: 'ja-JP',
          colorScheme: 'light',
          userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36',
        });
        const page = await context.newPage();
        await page.goto(`https://x.com/${acctSan}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await page.waitForLoadState('networkidle').catch(() => {});
        await page.waitForSelector('article[role="article"]', { timeout: 30000 }).catch(() => {});
    const seen = new Set<string>();
        let captured = 0;
        while (captured < limit) {
          const articles = await page.locator('article[role="article"]').all();
          for (const article of articles) {
            if (captured >= limit) break;
            const link = article.locator('a[href*="/status/"]').first();
            const href = await link.getAttribute('href').catch(() => null);
            const m = href && href.match(/\/status\/(\d+)/);
            const tweetId = m ? m[1] : '';
            if (!tweetId || seen.has(tweetId)) continue;
            seen.add(tweetId);
      // optional: touch tweet text once to ensure article is stable; avoid strict by using first()
      try { await article.locator('[data-testid="tweetText"]').first().textContent().catch(() => ''); } catch { /* ignore */ }
            const dest = path.join(userOutDir, `inline-${Date.now()}-${tweetId}.png`);
            try {
              await article.screenshot({ path: dest, animations: 'disabled' });
              captured += 1;
            } catch { /* ignore */ }
          }
          if (captured < limit) {
            const last = await page.locator('article[role="article"]').last();
            await last.scrollIntoViewIfNeeded().catch(() => {});
            await page.waitForTimeout(1200);
          }
        }
        await browser.close();
        try { await new Promise(r => setTimeout(r, 400)); } catch { /* ignore */ }
      } catch (e) {
        log.warn(`[x:${accountId}] Inline Playwright fallback failed: ${(e as Error)?.message || String(e)}`);
        // フォールバック2: 外部ランナー（scripts/run-screenshot-grab.cjs）をNodeで実行
        try {
          const runner = path.join(process.cwd(), 'scripts', 'run-screenshot-grab.cjs');
          const nodeCmd = process.platform === 'win32' ? 'node.exe' : 'node';
          const baseOut = path.join(SCREENSHOT_ROOT, 'out', 'screenshots');
          await new Promise<void>((resolve) => {
            const child = spawn(nodeCmd, [runner, '--user', acctSan, '--count', String(Math.max(1, limit)), '--outDir', baseOut], { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'], shell: false });
            child.stdout?.on('data', (d) => { try { log.info('[screenshot-cli]', d.toString().trim()); } catch {} });
            child.stderr?.on('data', (d) => { try { log.warn('[screenshot-cli]', d.toString().trim()); } catch {} });
            child.on('close', () => resolve());
            child.on('error', () => resolve());
          });
          try { await new Promise(r => setTimeout(r, 500)); } catch { /* ignore */ }
        } catch { /* ignore */ }
      }

      // 取り直し後に再スキャン
      const names2 = await fs.readdir(userOutDir).catch(() => [] as string[]);
      const files2 = await Promise.all(names2
        .filter(n => n.toLowerCase().endsWith('.png'))
        .map(async (n) => {
          try {
            const p = path.join(userOutDir, n);
            const s = await fs.stat(p);
            return { name: n, path: p, mtime: s.mtimeMs || (s as any).mtime?.getTime?.() || 0 };
          } catch { return null as any; }
        }));
      sorted = (files2.filter(Boolean) as { name: string; path: string; mtime: number }[])
        .sort((a, b) => b.mtime - a.mtime)
        .slice(0, candidateCount);
      log.info(`[x:${accountId}] after fallback: pngs=${files2.filter(Boolean).length} sorted=${sorted.length}`);
    }
    // MP4ファイルとの関連付けと分類処理
    const mp4Files = await fs.readdir(userOutDir).catch(() => [] as string[]).then(names => 
      names.filter(n => n.toLowerCase().endsWith('.mp4')));
    const logEvent = (evt: string, data: any) => {
      log.info(`[scraper] ${evt}:`, JSON.stringify(data));
    };
    
    // MP4 association (SAFE MODE): restrict to strict basename match only.
    // 背景:
    //  * 過去の実装では tweetId を含む任意 mp4 を fuzzy で関連付け => 本来 screenshot 扱いすべき単一動画ツイートが
    //    初期分類で video_url になり direct capture パス(process:direct-capture-*) が一度も走らず
    //    runTestStats.directCaptureAttempts=0 / xVideoUrlItems>0 の品質劣化イベントを誘発。
    //  * 現行パイプラインでは screenshot ディレクトリに配置する派生 mp4 は `.copy.mp4` サフィックスであり、
    //    これらは初期ソースではないため除外すべき。
    //  * 誤分類再発防止のため tweetId だけを含む他ファイルや過去残骸 mp4 を無視し、
    //    「PNG と完全同名 (拡張子除く)」かつ derivative でないものに限定。
    // 追加ハードニング余地: mtime チェック (PNG と mp4 の生成時間差が大きい場合は無視) — 必要なら後続対応。
    const associateMP4 = (pngBase: string /* strict base */, _tweetId?: string): string | undefined => {
      // derivative / legacy 派生は除外
      const candidate = mp4Files.find(mp4 => {
        if (/\.copy\.mp4$/i.test(mp4)) return false; // 新: derivative
        if (/-f\d{3}\.mp4$/i.test(mp4)) return false; // 旧: derivative パターン
        const mp4Base = mp4.replace(/\.mp4$/i, '');
        return mp4Base === pngBase; // 厳密一致のみ
      });
      if (candidate) {
        logEvent('x-mp4-assoc-strict', { acct: accountId, file: candidate, base: pngBase });
        return candidate;
      }
      return undefined; // fuzzy 不採用
    };

  let videoCount = 0, screenshotCount = 0;
    for (const f of sorted) {
      const base = f.name.replace(/\.png$/i, '');
      const metaPath = path.join(userOutDir, `${base}.json`);
      let tweetId: string | undefined;
      let url: string | undefined;
      try {
        const metaRaw = await fs.readFile(metaPath, 'utf8');
        const meta = JSON.parse(metaRaw);
        tweetId = meta?.tweetId || undefined;
        url = meta?.href || undefined;
      } catch { /* ignore: meta JSON が無いケースもある */ }
      if (!tweetId) {
        // 旧命名規則: xshot-<user>-<tweetId>-<...>.png から抽出を試みる
        const m = base.match(/xshot-[^-]+-(\d+)-/);
        tweetId = m ? m[1] : undefined;
      }
      
      // MP4ファイル関連付けによる分類
  const associatedMp4 = associateMP4(base, tweetId);
      const itemType = associatedMp4 ? 'video_url' : 'screenshot';
      if (itemType === 'video_url' && associatedMp4) {
        videoCount++;
        // MP4ファイルのフルパスを設定
        url = url || `file:///${path.join(userOutDir, associatedMp4).replace(/\\/g, '/')}`;
      } else {
        screenshotCount++;
      }
      
      // tweetId が無い場合でもテスト処理では一意IDがあれば十分なので、ファイル名をIDにフォールバック
      const id = tweetId || base;
      if (!tweetId) {
        log.warn(`[x:${accountId}] tweetId missing for ${f.name}; using filename as id fallback.`);
      }
      if (sinceCursor && id === sinceCursor) {
        log.info(`[x:${accountId}] sinceCursor reached (${sinceCursor}); stopping enumeration.`);
        break;
      }
      results.push({ id, type: itemType, path: f.path, url });
      if (results.length >= limit) break;
    }
    logEvent('x-classify-summary', { acct: accountId, total: results.length, video: videoCount, screenshot: screenshotCount, tinySkipped: 0 });
  } catch (e) {
    const err = e as Error & { message?: string };
    log.error(`[x:${accountId}] listRecentItemsX_viaBackend failed: ${err?.message || String(e)}`);
  }
  return results;
}
