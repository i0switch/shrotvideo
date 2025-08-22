import log from 'electron-log';
import type { AppSettings, Platform } from '../../src/core/settings';
import { app, BrowserWindow } from 'electron';
import path from 'path';
import fs from 'node:fs/promises';
import * as keytar from 'keytar';
import { restoreCookies } from '../login';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import ffmpegStatic from 'ffmpeg-static';
const execFileAsync = promisify(execFile);

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
  const yt = new YtDlp({ ffmpegPath: ffmpegStatic || undefined });
  const binPath = (helpers.findYtdlpBinary?.() as string | undefined) || undefined;
  return { yt, binPath };
}

export type ScrapeResult = { type: 'screenshot', path: string } | { type: 'video_url', url: string };

function getPlatformUrl(platform: Platform, accountId: string): string {
  switch (platform) {
    case 'x':
      return `https://x.com/${accountId}`;
    case 'tiktok':
      return `https://www.tiktok.com/@${accountId}`;
    case 'instagram':
      return `https://www.instagram.com/${accountId}`;
    case 'youtube':
  // /videos を付けると一覧が安定して取得できる
  return `https://www.youtube.com/@${accountId}/videos`;
    default:
      throw new Error(`Unsupported platform: ${platform}`);
  }
}

async function scrapeX(accountId: string): Promise<string | null> {
  log.info(`[x:${accountId}] Starting Electron offscreen scrape...`);
  // Ensure cookies present in defaultSession
  try {
    await restoreCookies('x');
  } catch (e) {
    const err = e as Error & { message?: string };
    log.warn(`[x:${accountId}] restoreCookies failed: ${err?.message || String(e)}`);
  }

  const win = new BrowserWindow({
    show: false,
    width: 1200,
    height: 900,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      offscreen: true,
    },
  });

  try {
    const url = getPlatformUrl('x', accountId);
    await win.loadURL(url);

    // Wait for timeline cells to appear
    await win.webContents.executeJavaScript(
      `new Promise(resolve => {
        const ready = () => {
          const el = document.querySelector('section[role="region"] div[data-testid="cellInnerDiv"]');
          if (el) return resolve(true);
          setTimeout(ready, 500);
        };
        ready();
      })`,
      true
    );

    // Try to find first retweet/repost-like cell and scroll into view
    const rect = await win.webContents.executeJavaScript(
      `(() => {
        const texts = ["Reposted", "reposted", "リポスト"]; 
        const nodes = Array.from(document.querySelectorAll('div[data-testid="cellInnerDiv"]'));
        const target = nodes.find(n => texts.some(t => n.textContent && n.textContent.includes(t)) ) || nodes[0];
        if (!target) return null;
        target.scrollIntoView({ block: 'center' });
        const r = target.getBoundingClientRect();
        return { x: Math.max(0, r.x|0), y: Math.max(0, r.y|0), width: Math.max(1, r.width|0), height: Math.max(1, r.height|0) };
      })()`
    );

  const screenshotPath = path.join(app.getPath('temp'), `screenshot-x-${accountId}-${Date.now()}.png`);
  const image = await win.webContents.capturePage(rect && rect.width && rect.height ? rect : undefined);
  // NativeImage in Electron has toPNG(); 型定義に合わせて実行時チェック
  const maybePng: Buffer | undefined = (image as unknown as { toPNG?: () => Buffer }).toPNG?.();
  await fs.writeFile(screenshotPath, maybePng ?? Buffer.from([]));

    log.info(`[x:${accountId}] Screenshot taken successfully: ${screenshotPath}`);
    return screenshotPath;
  } catch (error) {
    const e = error as Error & { message?: string };
    log.error(`[x:${accountId}] Electron scraping failed:`, e?.message || String(error));
    return null;
  } finally {
    try { if (!win.isDestroyed()) win.destroy(); } catch { /* ignore */ }
  }
}

export async function scrapeAccount(
  platform: Platform,
  accountId: string,
  settings: AppSettings,
): Promise<ScrapeResult | null> {
  log.info(`[${platform}:${accountId}] Starting scrape...`);

  if (platform === 'tiktok' || platform === 'youtube' || platform === 'instagram') {
    const accountUrl = getPlatformUrl(platform, accountId);
    try {
      log.info(`[${platform}:${accountId}] Using ytdlp-nodejs to get latest item from ${accountUrl}`);
      const { yt, binPath } = await getYtdlpClient();
      const baseOpts = {
        flatPlaylist: true,
        playlistEnd: 1,
        skipDownload: true,
        noCheckCertificates: true,
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36',
        impersonate: ['chrome'] as string[],
      } as const;
      // Try module first
      try {
        const info: any = await yt.getInfoAsync(accountUrl, baseOpts as any);
        const entry = Array.isArray(info?.entries) ? info.entries[0] : info;
        let pageUrl = (entry?.webpage_url || entry?.original_url || entry?.url || '') as string;
        if (platform === 'youtube') {
          // Normalize to proper video URL if only id or tab URL provided
          const vid = (entry?.id as string | undefined) && (entry.id as string).length === 11 ? (entry.id as string) : undefined;
          if (!/https?:\/\/(www\.)?youtube\.com\/watch\?v=/.test(pageUrl)
            && !/https?:\/\/(www\.)?youtube\.com\/shorts\//.test(pageUrl)
            && !/https?:\/\/(www\.)?youtu\.be\//.test(pageUrl)
            && vid) {
            pageUrl = `https://www.youtube.com/watch?v=${vid}`;
          }
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
        const { stdout } = await execFileAsync(bin, args);
        const data = JSON.parse(stdout);
        const entry = Array.isArray(data?.entries) ? data.entries[0] : data;
        let pageUrl = (entry?.webpage_url || entry?.original_url || entry?.url || '') as string;
        if (platform === 'youtube') {
          const vid = (entry?.id as string | undefined) && (entry.id as string).length === 11 ? (entry.id as string) : undefined;
          if (!/https?:\/\/(www\.)?youtube\.com\/watch\?v=/.test(pageUrl)
            && !/https?:\/\/(www\.)?youtube\.com\/shorts\//.test(pageUrl)
            && !/https?:\/\/(www\.)?youtu\.be\//.test(pageUrl)
            && vid) {
            pageUrl = `https://www.youtube.com/watch?v=${vid}`;
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
      if (platform === 'instagram') {
        const items = await listRecentItemsInstagramByWeb(accountId, 1);
        if (items.length) {
          const it = items[0];
          return { type: 'screenshot', path: it.path! };
        }
      }
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

export type ListedItem = { id: string; type: 'screenshot' | 'video_url'; url?: string; path?: string };

/**
 * List recent items for a platform/account. Ordered newest -> older.
 * sinceCursor: if provided, stop before reaching that id (do not include it).
 */
export async function listRecentItems(platform: Platform, accountId: string, limit: number, sinceCursor?: string): Promise<ListedItem[]> {
  if (limit <= 0) return [];
  if (platform === 'x') {
    return await listRecentItemsX(accountId, limit, sinceCursor);
  }
  if (platform === 'tiktok' || platform === 'instagram' || platform === 'youtube') {
    return await listRecentItemsViaYtDlp(platform, accountId, limit, sinceCursor);
  }
  return [];
}

async function listRecentItemsX(accountId: string, limit: number, sinceCursor?: string): Promise<ListedItem[]> {
  // Open offscreen window and enumerate first N posts
  const win = new BrowserWindow({
    show: false,
    width: 1200,
    height: 900,
    webPreferences: { contextIsolation: true, nodeIntegration: false, offscreen: true },
  });
  try {
  try { await restoreCookies('x'); } catch { /* ignore */ }
    const url = getPlatformUrl('x', accountId);
    await win.loadURL(url);
    await win.webContents.executeJavaScript(
      `new Promise(resolve => {
        const ready = () => {
          const els = document.querySelectorAll('article[role="article"] time');
          if (els && els.length) return resolve(true);
          setTimeout(ready, 400);
        };
        ready();
      })`,
      true
    );

    // Collect up to limit articles with their time datetime as id and bounding rect
    const infos: Array<{ id: string; rect: { x: number; y: number; width: number; height: number } }> = await win.webContents.executeJavaScript(
      `(() => {
        const arts = Array.from(document.querySelectorAll('article[role="article"]'));
        const out = [];
        for (const a of arts) {
          const t = a.querySelector('time');
          const id = t && t.getAttribute('datetime') ? t.getAttribute('datetime') : String(Date.now());
          const r = a.getBoundingClientRect();
          out.push({ id, rect: { x: Math.max(0, r.x|0), y: Math.max(0, r.y|0), width: Math.max(1, r.width|0), height: Math.max(1, r.height|0) } });
          if (out.length >= ${limit}) break;
        }
        return out;
      })()`
    );

    const results: ListedItem[] = [];
    for (const info of infos) {
      if (sinceCursor && info.id === sinceCursor) break;
  const image = await win.webContents.capturePage(info.rect as unknown as Electron.Rectangle);
      const file = path.join(app.getPath('temp'), `xshot-${accountId}-${info.id.replace(/[:.]/g,'-')}.png`);
  // NativeImage in Electron has toPNG(); add runtime guard
  const buf = (image as unknown as { toPNG?: () => Buffer })?.toPNG ? (image as unknown as { toPNG?: () => Buffer }).toPNG!() : Buffer.from([]);
  await fs.writeFile(file, buf);
      results.push({ id: info.id, type: 'screenshot', path: file });
    }
    return results;
  } catch (e) {
    const err = e as Error & { message?: string };
    log.warn(`[x:${accountId}] listRecentItems failed: ${err?.message || String(e)}`);
    return [];
  } finally {
    try { if (!win.isDestroyed()) win.destroy(); } catch { /* ignore */ }
  }
}

async function listRecentItemsViaYtDlp(platform: Exclude<Platform, 'x'>, accountId: string, limit: number, sinceCursor?: string): Promise<ListedItem[]> {
  const url = getPlatformUrl(platform, accountId);
  try {
    // Use ytdlp-nodejs client (no PATH dependency)
  const { yt } = await getYtdlpClient();
    const common = {
      flatPlaylist: true,
      playlistEnd: Math.max(1, limit),
      skipDownload: true,
      noCheckCertificates: true,
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36',
      impersonate: ['chrome'] as string[],
    };
  let res: any = await yt.getInfoAsync(url, common);
    // YouTubeでは channel/@name を渡すと first entry がタブURLになることがあるため補正
    const ensureYouTubeEntries = async (r: any): Promise<any[]> => {
      const entries: any[] = Array.isArray(r?.entries) ? r.entries : [];
      if (platform !== 'youtube') return entries;
      // 既にwatch/shortsが含まれていればOK
      const looksVideo = (e: any) => {
        const u = (e?.webpage_url || e?.original_url || e?.url || '') as string;
        const id = e?.id as string | undefined;
        return (
          /https?:\/\/(www\.)?youtube\.com\/watch\?v=/.test(u) ||
          /https?:\/\/(www\.)?youtube\.com\/shorts\//.test(u) ||
          /https?:\/\/(www\.)?youtu\.be\//.test(u) ||
          (id && id.length === 11)
        );
      };
      if (entries.some(looksVideo)) return entries;
      // entries がタブURL（/videos 等）しかない場合、そのURLで再取得
      const tabUrl = (r?.webpage_url || r?.original_url || r?.url || url) as string;
      try {
        const r2 = await yt.getInfoAsync(tabUrl, { ...common, flatPlaylist: true, playlistEnd: Math.max(1, limit) });
        const e2: any[] = Array.isArray(r2?.entries) ? r2.entries : [];
        return e2;
      } catch {
        return entries; // だめなら元のまま
      }
    };
    const entries = await ensureYouTubeEntries(res);
  const out: ListedItem[] = [];
    for (const e of entries as Array<Record<string, unknown>>) {
      let id = String((e as { id?: unknown })?.id ?? `${(e as { extractor_key?: string })?.extractor_key || 'unknown'}:${(e as { webpage_url?: string; url?: string })?.webpage_url || (e as { url?: string })?.url || 'unknown'}`);
      if (sinceCursor && id === sinceCursor) break;
      const rawUrl = ((e as any)?.webpage_url || (e as any)?.original_url || (e as any)?.url || '') as string;
      let pageUrl = rawUrl;
      if (platform === 'youtube') {
        // watch/shorts/youtu.be 以外の場合は id から watch URL を作成
        if (!/https?:\/\/(www\.)?youtube\.com\/watch\?v=/.test(pageUrl)
          && !/https?:\/\/(www\.)?youtube\.com\/shorts\//.test(pageUrl)
          && !/https?:\/\/(www\.)?youtu\.be\//.test(pageUrl)) {
          const vid = (e as any)?.id as string | undefined;
          if (vid && vid.length === 11) {
            pageUrl = `https://www.youtube.com/watch?v=${vid}`;
            id = vid;
          } else {
            // 不要なエントリ（タブ等）はスキップ
            continue;
          }
        }
      }
      if (!pageUrl) continue;
      out.push({ id, type: 'video_url', url: pageUrl });
      if (out.length >= limit) break;
    }
    // If we couldn't extract any usable entries, try web fallbacks for specific platforms
    if (out.length === 0) {
      try {
        if (platform === 'instagram') {
          const webItems = await listRecentItemsInstagramByWeb(accountId, Math.max(1, limit), sinceCursor);
          if (webItems.length) return webItems;
        } else if (platform === 'youtube') {
          const webItems = await listRecentItemsYouTubeByWeb(accountId, Math.max(1, limit), sinceCursor);
          if (webItems.length) return webItems;
        }
      } catch { /* ignore and fallthrough to return [] */ }
    }
    return out;
  } catch (modErr) {
    const me = modErr as Error & { message?: string };
    log.error(`[${platform}:${accountId}] listRecentItems via yt-dlp (module) failed: ${me?.message || String(modErr)}`);
    // Best-effort fallback to CLI if available
    try {
  const { binPath } = await getYtdlpClient();
  const bin = binPath || 'yt-dlp';
  const { stdout } = await execFileAsync(bin, ['-J', url]);
      const data = JSON.parse(stdout);
      const entries: Array<Record<string, unknown>> = Array.isArray((data as { entries?: unknown })?.entries)
        ? (data as { entries: Array<Record<string, unknown>> }).entries
        : [];
      const out: ListedItem[] = [];
      for (const e of entries) {
        const id = String((e as { id?: unknown })?.id ?? `${(e as { extractor_key?: string })?.extractor_key || 'unknown'}:${(e as { webpage_url?: string; url?: string })?.webpage_url || (e as { url?: string })?.url || 'unknown'}`);
        if (sinceCursor && id === sinceCursor) break;
        const pageUrl = (e as { webpage_url?: string; original_url?: string; url?: string }).webpage_url
          || (e as { original_url?: string }).original_url
          || (e as { url?: string }).url;
        if (!pageUrl) continue;
        out.push({ id, type: 'video_url', url: pageUrl });
        if (out.length >= limit) break;
      }
      return out;
    } catch (cliErr) {
      const ce = cliErr as Error & { message?: string };
      log.warn(`[${platform}:${accountId}] yt-dlp CLI fallback also failed: ${ce?.message || String(cliErr)}`);
      // Instagram は extractor 側の破損が頻発するため、最終フォールバックとしてスクショ生成に切替
      if (platform === 'instagram') {
        try {
          const items = await listRecentItemsInstagramByWeb(accountId, Math.max(1, limit), sinceCursor);
          return items;
        } catch (e) {
          log.warn(`[instagram:${accountId}] web fallback failed: ${(e as Error).message}`);
        }
      }
      if (platform === 'youtube') {
        try {
          const items = await listRecentItemsYouTubeByWeb(accountId, Math.max(1, limit), sinceCursor);
          return items;
        } catch (e) {
          log.warn(`[youtube:${accountId}] web fallback failed: ${(e as Error).message}`);
        }
      }
      return [];
    }
  }
}

// ===== Instagram fallback: Webによる簡易スクショ収集 =====
async function listRecentItemsInstagramByWeb(accountId: string, limit: number, sinceCursor?: string): Promise<ListedItem[]> {
  const win = new BrowserWindow({
    show: false,
    width: 1200,
    height: 1200,
    webPreferences: { contextIsolation: true, nodeIntegration: false, offscreen: true, backgroundThrottling: false },
  });
  try {
    try { await restoreCookies('instagram'); } catch { /* ignore */ }
    // Set a stable desktop UA to reduce IG anti-bot quirks
    try { win.webContents.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36'); } catch { /* ignore */ }
    const profileUrl = `https://www.instagram.com/${accountId}/`;
    await win.loadURL(profileUrl);
    // 小さくスクロールしてレンダリングを促進
    try {
      await win.webContents.executeJavaScript(
        `(() => { try { window.scrollTo(0, 1); setTimeout(() => window.scrollTo(0, 0), 200); } catch {} })()`
      );
    } catch { /* ignore */ }
    // Try dismissing cookie/login banners best-effort
    try {
      await win.webContents.executeJavaScript(
        `new Promise(resolve => {
          try {
            const clickByText = (texts) => {
              const btns = Array.from(document.querySelectorAll('button'));
              for (const b of btns) {
                const t = (b.textContent || '').trim();
                if (texts.some(x => t.includes(x))) { try { b.click(); } catch {} return true; }
              }
              return false;
            };
            // Cookie consent buttons (common EN/JA variants)
            clickByText(["Allow essential cookies", "必須クッキーを許可", "Accept all", "同意する", "許可する"]); 
            // Login modal close (if any)
            const dlgBtn = document.querySelector('div[role="dialog"] button[role="button"]');
            if (dlgBtn) { try { (dlgBtn as HTMLButtonElement).click(); } catch {} }
          } catch {}
          resolve(true);
        })`,
        true
      );
    } catch { /* ignore */ }

    // Wait for grid anchors with robust guard (never throw)
    await win.webContents.executeJavaScript(
      `new Promise((resolve) => {
        try {
          const started = Date.now();
          const loop = () => {
            try {
              const anchors = document.querySelectorAll('a[href*="/reel/"], a[href*="/p/"]');
              if (anchors && anchors.length) return resolve(true);
              if (Date.now() - started > 12000) return resolve(false);
            } catch {}
            setTimeout(loop, 400);
          };
          loop();
        } catch { resolve(false); }
      })`,
      true
    );
    // ログインモーダルや同意バナーの表示によって要素が隠れているときは、再度クリックを試みる
    try {
      await win.webContents.executeJavaScript(
        `(() => { try {
            const buttons = Array.from(document.querySelectorAll('button'));
            const tryClick = (kw) => { const b = buttons.find(btn => (btn.textContent||'').includes(kw)); if (b) { try { b.click(); return true; } catch {} } return false; };
            tryClick('Allow essential cookies') || tryClick('必須クッキー') || tryClick('同意') || tryClick('Accept') || tryClick('許可');
            const closeBtn = document.querySelector('div[role="dialog"] button[role="button"]');
            if (closeBtn) { try { (closeBtn).click(); } catch {} }
          } catch {} })()`
      );
    } catch { /* ignore */ }
    // 先頭から最大limit 件の矩形を取得（スクリプト例外を内部でキャッチ）
  const rects: Array<{ id: string; rect: { x: number; y: number; width: number; height: number } }> = await win.webContents.executeJavaScript(
      `(() => {
        try {
          const els = Array.from(document.querySelectorAll('a[href*="/reel/"], a[href*="/p/"]'));
          const out = [];
          for (const a of els) {
            try {
              const href = a.getAttribute('href') || '';
              const id = href.replace(/\/?$/, '') || String(Date.now());
              const r = a.getBoundingClientRect();
              if (r && r.width > 10 && r.height > 10) {
                out.push({ id, rect: { x: Math.max(0, r.x|0), y: Math.max(0, r.y|0), width: Math.max(1, r.width|0), height: Math.max(1, r.height|0) } });
              }
              if (out.length >= ${Math.max(1, limit)}) break;
            } catch {}
          }
          return out;
        } catch { return []; }
      })()`
    );
    const results: ListedItem[] = [];
    for (const info of rects) {
      if (sinceCursor && info.id === sinceCursor) break;
      const img = await win.webContents.capturePage(info.rect as unknown as Electron.Rectangle);
      const buf = (img as unknown as { toPNG?: () => Buffer })?.toPNG ? (img as any).toPNG() : Buffer.from([]);
      const file = path.join(app.getPath('temp'), `igshot-${accountId}-${info.id.replace(/[:./\\]/g,'-')}.png`);
      await fs.writeFile(file, buf);
      results.push({ id: info.id, type: 'screenshot', path: file });
      if (results.length >= limit) break;
    }
    log.info(`[instagram:${accountId}] web fallback produced ${results.length} item(s).`);
    return results;
  } catch (e) {
    log.warn(`[instagram:${accountId}] web fallback error: ${(e as Error).message || String(e)}`);
    return [];
  } finally {
    try { if (!win.isDestroyed()) win.destroy(); } catch { /* ignore */ }
  }
}

// ===== YouTube fallback: Webによる最新動画URL取得 =====
async function listRecentItemsYouTubeByWeb(accountId: string, limit: number, sinceCursor?: string): Promise<ListedItem[]> {
  const win = new BrowserWindow({
    show: false,
    width: 1280,
    height: 900,
    webPreferences: { contextIsolation: true, nodeIntegration: false, offscreen: true, backgroundThrottling: false },
  });
  try {
    const url = `https://www.youtube.com/@${accountId}/videos`;
    try { win.webContents.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36'); } catch { /* ignore */ }
    await win.loadURL(url);
    try { await win.webContents.executeJavaScript(`(() => { try { window.scrollTo(0, 1); setTimeout(() => window.scrollTo(0, 0), 150); } catch {} })()`); } catch { /* ignore */ }
    // 最初の動画リンクが描画されるまで待機
    await win.webContents.executeJavaScript(
      `new Promise(resolve => {
        try {
          const start = Date.now();
          const tick = () => {
            try {
              const a = document.querySelector('a[href^="/watch?v="]');
              if (a) return resolve(true);
              if (Date.now() - start > 16000) return resolve(false);
            } catch {}
            setTimeout(tick, 400);
          };
          tick();
        } catch { resolve(false); }
      })`,
      true
    );
    // 上位limit件の動画リンクを収集
    const links: Array<{ id: string; href: string }> = await win.webContents.executeJavaScript(
      `(() => {
        try {
          const anchors = Array.from(document.querySelectorAll('a[href^="/watch?v="]'));
          const out = [];
          for (const a of anchors) {
            try {
              const href = a.getAttribute('href') || '';
              const u = new URL(href, location.origin).toString();
              const id = (u.match(/v=([\w-]{11})/) || [])[1] || u;
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
