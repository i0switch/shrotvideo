import log from 'electron-log';
import type { AppSettings, Platform } from '../../src/core/settings';
import { app, BrowserWindow } from 'electron';
import path from 'path';
import fs from 'node:fs/promises';
import * as keytar from 'keytar';
import { restoreCookies } from '../login';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execFileAsync = promisify(execFile);

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
      return `https://www.youtube.com/@${accountId}`;
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
      log.info(`[${platform}:${accountId}] Using yt-dlp to get latest video URL from ${accountUrl}`);
      // Dynamically import the ESM ytdlp-nodejs module
  // 型定義がないため、any相当として扱う
  const ytdlpMod = await import('ytdlp-nodejs');
  const ytdlp = (ytdlpMod as unknown as { default?: unknown }).default as unknown as (u: string, o?: Record<string, unknown>) => Promise<Record<string, unknown>>;
  const video = await ytdlp(accountUrl, {
        dumpSingleJson: true,
        playlistItems: '1',
      });

  const url = (video as { url?: string; webpage_url?: string }).url || (video as { webpage_url?: string }).webpage_url;
      if (url) {
        log.info(`[${platform}:${accountId}] Found video URL: ${url}`);
        return { type: 'video_url', url };
      } else {
         log.warn(`[${platform}:${accountId}] yt-dlp did not return a usable URL.`);
         return null;
      }
    } catch (error) {
      const e = error as Error & { message?: string };
      log.error(`[${platform}:${accountId}] yt-dlp failed:`, e.message || String(error));
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
    // Prefer CLI -J to get full JSON including entries (flat playlist for speed)
    const { stdout } = await execFileAsync('yt-dlp', ['-J', url]);
    const data = JSON.parse(stdout);
  const entries: Array<Record<string, unknown>> = Array.isArray((data as { entries?: unknown })?.entries) ? (data as { entries: Array<Record<string, unknown>> }).entries : [];
    const out: ListedItem[] = [];
    for (const e of entries) {
      const id = String(e.id ?? e.extractor_key + ':' + (e.webpage_url || e.url || 'unknown'));
      if (sinceCursor && id === sinceCursor) break;
  const pageUrl = (e as { webpage_url?: string; original_url?: string; url?: string }).webpage_url || (e as { original_url?: string }).original_url || (e as { url?: string }).url;
      if (!pageUrl) continue;
      out.push({ id, type: 'video_url', url: pageUrl });
      if (out.length >= limit) break;
    }
    return out;
  } catch (cliErr) {
    const ce = cliErr as Error & { message?: string };
    log.warn(`[${platform}:${accountId}] yt-dlp CLI -J failed, fallback to node module: ${ce?.message || String(cliErr)}`);
    try {
      const ytdlpMod = await import('ytdlp-nodejs');
      const ytdlp = (ytdlpMod as unknown as { default?: unknown }).default as unknown as (u: string, o?: Record<string, unknown>) => Promise<Record<string, unknown>>;
      const res = await ytdlp(url, { dumpSingleJson: true });
      const entries: Array<Record<string, unknown>> = Array.isArray((res as { entries?: unknown })?.entries) ? (res as { entries: Array<Record<string, unknown>> }).entries : [];
      const out: ListedItem[] = [];
      for (const e of entries) {
        const id = String((e as { id?: unknown; extractor_key?: string; webpage_url?: string; url?: string }).id ?? `${(e as { extractor_key?: string }).extractor_key}:${(e as { webpage_url?: string; url?: string }).webpage_url || (e as { url?: string }).url || 'unknown'}`);
        if (sinceCursor && id === sinceCursor) break;
        const pageUrl = (e as { webpage_url?: string; original_url?: string; url?: string }).webpage_url || (e as { original_url?: string }).original_url || (e as { url?: string }).url;
        if (!pageUrl) continue;
        out.push({ id, type: 'video_url', url: pageUrl });
        if (out.length >= limit) break;
      }
      return out;
    } catch (modErr) {
      const me = modErr as Error & { message?: string };
      log.error(`[${platform}:${accountId}] listRecentItems via yt-dlp failed: ${me?.message || String(modErr)}`);
      return [];
    }
  }
}
