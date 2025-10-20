import log from 'electron-log';
import type { AppSettings, Platform } from '../../src/core/settings';
import { app, BrowserWindow } from 'electron';
import path from 'path';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import { restoreCookies } from '../auth-utils';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import ffmpegStatic from 'ffmpeg-static';
const execFileAsync = promisify(execFile);

// Cross-platform screenshot root resolver for X backend
function getScreenshotRoot(): string {
  try {
    // Prefer an OS-safe user directory. On Windows, historically a Desktop path was used; we preserve it if exists.
    if (process.platform === 'win32') {
      const legacy = 'C:\\\\Users\\\\i0swi\\\\OneDrive\\\\デスクトップ\\\\dougadownload\\\\screenshot';
      if (existsSync(legacy)) return legacy;
      // Fallback to Pictures/dougadownload/screenshot
      return path.join(app.getPath('pictures'), 'dougadownload', 'screenshot');
    }
    // macOS/Linux: use Pictures/dougadownload/screenshot
    return path.join(app.getPath('pictures'), 'dougadownload', 'screenshot');
  } catch {
    // Last resort: userData under app container
    try { return path.join(app.getPath('userData'), 'screenshots'); } catch { /* ignore */ }
  }
  return path.join(process.cwd(), 'screenshots');
}

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
    // keytar may be unavailable on some systems; load dynamically and continue without cookies if it fails
    let keytar: any = null;
    try { keytar = await import('keytar'); } catch { keytar = null; }
    if (!keytar) {
      log.info(`[scraper:${platform}] keytar not available; proceeding without cookies.`);
      return undefined;
    }
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

// Resolve Playwright browser path for packaged app (resources/playwright_browsers)
function getPlaywrightEnv() {
  const env = { ...process.env } as NodeJS.ProcessEnv;
  try {
    // Prefer extraResources when packaged
    const resPath = (app as any).isPackaged ? process.resourcesPath : null;
    if (resPath) {
      const browsersDir = path.join(resPath, 'playwright_browsers');
      env.PLAYWRIGHT_BROWSERS_PATH = browsersDir; // absolute path where browsers are shipped
    } else {
      // Fallback to project-local packaged browsers inside node_modules
      env.PLAYWRIGHT_BROWSERS_PATH = env.PLAYWRIGHT_BROWSERS_PATH || '0';
    }
  } catch {
    env.PLAYWRIGHT_BROWSERS_PATH = env.PLAYWRIGHT_BROWSERS_PATH || '0';
  }
  // Needed when spawning electron to run scripts as Node
  env.ELECTRON_RUN_AS_NODE = '1';
  return env;
}

// Helper: run screenshot backend runner (screenshot/bin/grab.cjs) via Electron's Node
async function runScreenshotGrab(user: string, count: number): Promise<void> {
  // Resolve script path robustly: prefer workspace CWD during dev, fallback to appPath for packaged
  const appPath = app.getAppPath();
  const candCwd = path.join(process.cwd(), 'screenshot', 'bin', 'grab.cjs');
  const candApp = path.join(appPath, 'screenshot', 'bin', 'grab.cjs');
  const script = existsSync(candCwd) ? candCwd : candApp;
  const outBase = path.join(getScreenshotRoot(), 'out', 'screenshots');
  try { await fs.mkdir(outBase, { recursive: true }); } catch { /* ignore */ }
  await new Promise<void>((resolve) => {
  const env = getPlaywrightEnv();
    let stderr = '';
    try {
      log.info(`[screenshot:grab] spawn: exe=${process.execPath} script=${script} user=${user} count=${count} out=${outBase}`);
      const child = spawn(process.execPath, [script, '--user', user, '--count', String(Math.max(1, count)), '--outDir', outBase], { env, stdio: ['ignore', 'pipe', 'pipe'] });
      child.stderr?.on('data', (d) => { stderr += d?.toString?.() || ''; });
      child.stdout?.on('data', (d) => { const s = d?.toString?.(); if (s) log.info('[screenshot:grab:out]', s.trim()); });
      child.on('close', (code) => {
        if (code !== 0) {
          log.warn(`[screenshot:grab] exited with code ${code}. stderr: ${stderr?.slice?.(0, 4000)}`);
        }
        resolve();
      });
      child.on('error', () => resolve());
    } catch {
      resolve();
    }
  });
}

export async function scrapeX(accountId: string): Promise<string | null> {
  // Force using screenshot subapp runner only
  const acctSan = accountId.startsWith('@') ? accountId.substring(1) : accountId;
  const userOutDir = path.join(getScreenshotRoot(), 'out', 'screenshots', acctSan);
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

      // Web fallbacks
      if (platform === 'youtube') {
        const items = await listRecentItemsYouTubeByWeb(accountId, 1);
        if (items.length) {
          const it = items[0];
          return { type: 'video_url', url: it.url! };
        }
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

export type ListedItem = { id: string; type: 'screenshot' | 'video_url'; url?: string; path?: string; classification?: string };

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
    return await listRecentItemsViaYtDlp(platform, accountId, limit, sinceCursor);
  }
  return [];
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
  const userOutDir = path.join(getScreenshotRoot(), 'out', 'screenshots', acctSan);
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
  // Prefer full playwright; fallback to playwright-core in packaged runtime
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  let chromium: any;
  try { chromium = require('playwright').chromium; } catch { chromium = require('playwright-core').chromium; }
  const storageStatePath = path.join(getScreenshotRoot(), '.auth', 'x.storage.json');
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
          const baseOut = path.join(getScreenshotRoot(), 'out', 'screenshots');
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
    for (const f of sorted) {
      const base = f.name.replace(/\.png$/i, '');
      const metaPath = path.join(userOutDir, `${base}.json`);
      let tweetId: string | undefined;
      let classification: string | undefined;
      let url: string | undefined;
      try {
        const metaRaw = await fs.readFile(metaPath, 'utf8');
        const meta = JSON.parse(metaRaw);
        tweetId = meta?.tweetId || undefined;
        url = meta?.href || undefined;
        classification = meta?.classification || undefined;
      } catch { /* ignore: meta JSON が無いケースもある */ }
      if (!tweetId) {
        // 旧命名規則: xshot-<user>-<tweetId>-<...>.png から抽出を試みる
        const m = base.match(/xshot-[^-]+-(\d+)-/);
        tweetId = m ? m[1] : undefined;
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
  results.push({ id, type: 'screenshot', path: f.path, url, classification });
      if (results.length >= limit) break;
    }
  } catch (e) {
    const err = e as Error & { message?: string };
    log.error(`[x:${accountId}] listRecentItemsX_viaBackend failed: ${err?.message || String(e)}`);
  }
  return results;
}

async function listRecentItemsViaYtDlp(platform: Exclude<Platform, 'x'>, accountId: string, limit: number, sinceCursor?: string): Promise<ListedItem[]> {
  // YouTube はShortsタブを直接対象
  const url = platform === 'youtube' ? `https://www.youtube.com/@${accountId}/shorts` : getPlatformUrl(platform, accountId);
  log.info(`[scraper:${platform}:${accountId}] START: listRecentItemsViaYtDlp with yt-dlp JSON strategy`);
  
  let cookieFile: string | undefined;
  try {
    const { binPath } = await getYtdlpClient();
    const bin = binPath || 'yt-dlp';
    cookieFile = await createCookieFileIfAny(platform);

    let args: string[];
    if (platform === 'youtube') {
      // Shortsタブ限定 + まとめてJSON出力（フラット化＆エラー無視＆件数制限）
    const end = Math.max(12, limit * 5); // 候補数を広げて不足を避ける（limitの約5倍、最低12件）
      args = [
        url,
        '-J',
        '--flat-playlist',
        '--ignore-errors',
        '--no-warnings',
        '--impersonate', 'chrome',
        '--extractor-args', 'youtube:tab=shorts',
        '--playlist-end', String(end),
        '--verbose'
      ];
  } else {
      args = [
        url,
        '--dump-json',
    '--flat-playlist',
    `--playlist-end`, `${Math.max(12, limit * 5)}`,
        '--no-warnings',
        '--impersonate', 'chrome',
        '--verbose'
      ];
    }

    if (cookieFile) {
      args.push('--cookies', cookieFile);
    }

    const fullCommand = `${bin} ${args.join(' ')}`;
    log.info(`[scraper:${platform}:${accountId}] Executing yt-dlp CLI: ${fullCommand}`);

  const { stdout, stderr } = await execFileAsync(bin, args, { timeout: 60000, windowsHide: true });

    log.info(`[scraper:${platform}:${accountId}] yt-dlp CLI stdout:`, stdout);
    if (stderr) {
        log.warn(`[scraper:${platform}:${accountId}] yt-dlp CLI stderr:`, stderr);
    }

    const out: ListedItem[] = [];
  if (platform === 'youtube') {
      // 単一JSONを解析
      let data: any;
      try { data = JSON.parse(stdout); } catch (e) {
        log.error(`[scraper:${platform}:${accountId}] Failed to parse -J JSON:`, (e as Error).message);
        data = null;
      }
      const flat: any[] = [];
      const pushEntry = (en: any) => { if (en) flat.push(en); };
      if (data) {
        if (Array.isArray(data.entries)) {
          for (const en of data.entries) {
            if (en && Array.isArray(en.entries)) {
              // ネスト（万一別タブが混ざる場合もある）
              for (const en2 of en.entries) pushEntry(en2);
            } else {
              pushEntry(en);
            }
          }
        } else {
          pushEntry(data);
        }
      }
      log.info(`[scraper:${platform}:${accountId}] Collected ${flat.length} candidate entries from -J.`);
      for (const e of flat) {
        const id = e.id || e.url;
        let pageUrl: string | undefined = e.webpage_url || e.url;
        if (!id && !pageUrl) continue;
        if (sinceCursor && id && id === sinceCursor) break;
        // 一部のエントリはURLが無くIDのみのことがあるためwatch?v=IDを補完
        if (!pageUrl && typeof id === 'string' && id.length === 11) {
          pageUrl = `https://www.youtube.com/watch?v=${id}`;
        }
        if (!pageUrl) continue;
        const dur = (e.duration || 0) as number;
        const avail = String(e.availability || '').toLowerCase();
        const isAllowedAvail = !avail || avail === 'public' || avail === 'unlisted';
        const isShortsUrl = /https?:\/\/(www\.)?youtube\.com\/shorts\//.test(pageUrl);
        const isBeShort = /https?:\/\/(www\.)?youtu\.be\//.test(pageUrl) && dur <= 61;
        const isWatchShort = /https?:\/\/(www\.)?youtube\.com\/watch\?v=/.test(pageUrl) && dur <= 61;
        if (!isAllowedAvail) {
          log.info(`[scraper:${platform}:${accountId}] Skipping due to availability=${avail} id=${id}`);
          continue;
        }
        if (!(isShortsUrl || isBeShort || isWatchShort)) continue;
        // 追加: 実際に再生可能かプローブ（メンバー限定や非公開を弾く）
        try {
          const playable = await isYouTubeShortPlayable(pageUrl, cookieFile);
          if (!playable) {
            log.info(`[scraper:${platform}:${accountId}] Skipping not-playable candidate (probe): ${pageUrl}`);
            continue;
          }
        } catch { /* ignore and skip */ continue; }
        out.push({ id: id || pageUrl, type: 'video_url', url: pageUrl });
        if (out.length >= limit) break;
      }
      // ここで不足があればWebフォールバックで補完
      if (out.length < limit) {
        try {
          const more = await listRecentItemsYouTubeByWeb(accountId, Math.max(limit * 2, 10), sinceCursor);
          // 重複排除しつつ追加
          const seen = new Set(out.map(i => i.id));
          for (const m of more) {
            if (!seen.has(m.id)) {
              out.push(m);
              seen.add(m.id);
              if (out.length >= limit) break;
            }
          }
        } catch { /* ignore */ }
      }
    } else {
      // 既存（TikTok等）: 行ごとJSON
      const lines = stdout.trim().split(/\r?\n/);
      const entries = lines.map(line => {
          try {
              return JSON.parse(line);
          } catch (e) {
              log.warn(`[scraper:${platform}:${accountId}] Failed to parse JSON line:`, line, e);
              return null;
          }
      }).filter(Boolean);

      log.info(`[scraper:${platform}:${accountId}] Found ${entries.length} valid items from yt-dlp.`);
      if (entries.length > 0) {
        log.info(`[scraper:${platform}:${accountId}] DEBUG: First item from yt-dlp:`, JSON.stringify(entries[0], null, 2));
      }
      for (const e of entries as any[]) {
        const id = e.id || e.url;
        const pageUrl = e.webpage_url || e.url;
        if (!id || !pageUrl) continue;
        if (sinceCursor && id === sinceCursor) break;
        out.push({ id, type: 'video_url', url: pageUrl });
        if (out.length >= limit) break;
      }
    }
    
    log.info(`[scraper:${platform}:${accountId}] Extracted ${out.length} items.`);
    // Shortsが見つからなければWebフォールバックも試す
    if (platform === 'youtube' && out.length === 0) {
      log.info(`[scraper:${platform}:${accountId}] No shorts via yt-dlp; falling back to web.`);
      return listRecentItemsYouTubeByWeb(accountId, limit, sinceCursor);
    }
    return out;

  } catch (err) {
    const e = err as Error & { code?: string, stdout?: string, stderr?: string };
    log.error(`[scraper:${platform}:${accountId}] ERROR: listRecentItemsViaYtDlp failed. Code: ${e.code}, Stderr: ${e.stderr}`);
  // Fallback to web scraping on failure
    log.info(`[scraper:${platform}:${accountId}] Falling back to web scraping due to error.`);
    if (platform === 'youtube') {
      return listRecentItemsYouTubeByWeb(accountId, limit, sinceCursor);
    }
    return [];
  } finally {
      if (cookieFile) {
          try { await fs.unlink(cookieFile); } catch {} // Best effort cleanup
      }
  }
}

// (Instagram fallback code removed)

// ===== YouTube fallback: Webによる最新動画URL取得 =====
async function listRecentItemsYouTubeByWeb(accountId: string, limit: number, sinceCursor?: string): Promise<ListedItem[]> {
  const win = new BrowserWindow({
    show: false,
    width: 1280,
    height: 900,
    webPreferences: { contextIsolation: true, nodeIntegration: false, offscreen: true, backgroundThrottling: false },
  });
  try {
  // Try to restore saved cookies (logged-in view may change visibility)
  try { await restoreCookies('youtube'); } catch { /* ignore */ }
  // 仕様変更: Shorts タブを直接開く
  const url = `https://www.youtube.com/@${accountId}/shorts`;
    try { win.webContents.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36'); } catch { /* ignore */ }
  await win.loadURL(url);
    try { await win.webContents.executeJavaScript(`(() => { try { window.scrollTo(0, 1); setTimeout(() => window.scrollTo(0, 0), 150); } catch {} })()`); } catch { /* ignore */ }
    // 最初の動画リンクが描画されるまで待機
  log.info(`[youtube:${accountId}] Waiting for Shorts links...`);
    let found = await win.webContents.executeJavaScript(
      `new Promise(resolve => {
        try {
          const start = Date.now();
          const tick = () => {
            try {
              // Shorts は /shorts/<id> 形式
              const a = document.querySelector('a[href^="/shorts/"]');
              if (a) { console.log('[yt-web-scraper] Found Shorts link.'); return resolve(true); }
              if (Date.now() - start > 12000) { console.log('[yt-web-scraper] Timeout waiting for Shorts link.'); return resolve(false); }
            } catch(e) { console.error('[yt-web-scraper] Error in link loop:', e); }
            setTimeout(tick, 400);
          };
          tick();
        } catch(e) { console.error('[yt-web-scraper] Error setting up link promise:', e); resolve(false); }
      })`,
      true
    );

    // Shorts タブで見つからない場合は /videos を開いて /shorts/ リンクを探す
    if (!found) {
      const alt = `https://www.youtube.com/@${accountId}/videos`;
      log.info(`[youtube:${accountId}] No Shorts link found on /shorts; trying /videos page.`);
      await win.loadURL(alt);
      found = await win.webContents.executeJavaScript(
        `new Promise(resolve => {
          try {
            const start = Date.now();
            const tick = () => {
              try {
                const a = document.querySelector('a[href^="/shorts/"]');
                if (a) { console.log('[yt-web-scraper] Found Shorts link on /videos.'); return resolve(true); }
                if (Date.now() - start > 10000) { return resolve(false); }
              } catch {}
              setTimeout(tick, 300);
            };
            tick();
          } catch { resolve(false); }
        })`,
        true
      );
    }
    // 上位limit件の動画リンクを収集
  const links: Array<{ id: string; href: string }> = await win.webContents.executeJavaScript(
      `(() => {
        try {
      const anchors = Array.from(document.querySelectorAll('a[href^="/shorts/"]'));
          const out = [];
          for (const a of anchors) {
            try {
              const href = a.getAttribute('href') || '';
              const u = new URL(href, location.origin).toString();
        // Shorts ID はパスセグメント末尾（11文字とは限らないケースもあるためそのまま利用）
        const m = u.match(/\/shorts\/([\w-]+)/);
        const id = (m && m[1]) || u;
              if (id) out.push({ id, href: u });
              if (out.length >= ${Math.max(1, limit)}) break;
            } catch {}
          }
          return out;
        } catch { return []; }
      })()`
    );
  const results: ListedItem[] = [];
    for (const l of links) {
      if (sinceCursor && l.id === sinceCursor) break;
      results.push({ id: l.id, type: 'video_url', url: l.href });
      if (results.length >= limit) break;
    }
    log.info(`[youtube:${accountId}] web fallback produced ${results.length} item(s).`);
    return results;
  } catch (e) {
    log.warn(`[youtube:${accountId}] web fallback error: ${(e as Error).message || String(e)}`);
    return [];
  } finally {
    try { if (!win.isDestroyed()) win.destroy(); } catch { /* ignore */ }
  }
}
