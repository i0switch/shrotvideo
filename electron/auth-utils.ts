import { session } from 'electron';
// keytar may be unavailable on some systems; load dynamically
let _keytarPromise: Promise<any> | null = null;
async function getKeytar(): Promise<any | null> {
  if (!_keytarPromise) {
    _keytarPromise = import('keytar').catch(() => null);
  }
  return _keytarPromise;
}
import type { Platform } from '../src/core/settings.js';
import log from 'electron-log';

const APP = 'ShortVideoAssistant';

// Function to save cookies for a specific platform
export async function saveCookies(platform: Platform, cookies: Electron.Cookie[]) {
  if (cookies.length === 0) return;
  try {
    const keytar = await getKeytar();
    if (!keytar) {
      log.warn(`[auth:${platform}] keytar not available; skipping secure cookie save.`);
      return;
    }
    await keytar.setPassword(APP, platform, JSON.stringify(cookies));
    log.info(`[auth:${platform}] Saved ${cookies.length} cookies securely.`);
  } catch (e) {
    const err = e as Error & { message?: string };
    log.error(`[auth:${platform}] Failed to save cookies:`, err?.message || String(e));
  }
}

// Function to restore cookies for a specific platform
export async function restoreCookies(platform: Platform) {
  try {
    const keytar = await getKeytar();
    if (!keytar) {
      log.warn(`[auth:${platform}] keytar not available; cannot restore cookies.`);
      return;
    }
    const raw = await keytar.getPassword(APP, platform);
    if (!raw) {
      log.info(`[auth:${platform}] No saved cookies found.`);
      return;
    }
    const cookies = JSON.parse(raw) as Electron.Cookie[];
    for (const c of cookies) {
      // Electron requires a URL when setting cookies; reconstruct it from domain/path.
      const domain = (c.domain || '').replace(/^\./, '');
      const path = c.path || '/';
      const scheme = c.secure ? 'https' : 'http';
      const url = domain ? `${scheme}://${domain}${path}` : undefined;
      if (!url) continue;
      await session.defaultSession.cookies.set({
        url,
        name: c.name,
        value: c.value,
        domain: c.domain,
        path: c.path,
        secure: c.secure,
        httpOnly: c.httpOnly,
        expirationDate: c.expirationDate,
        sameSite: c.sameSite,
      });
    }
    log.info(`[auth:${platform}] Restored ${cookies.length} cookies.`);
  } catch (e) {
    const err = e as Error & { message?: string };
    log.error(`[auth:${platform}] Failed to restore cookies:`, err?.message || String(e));
  }
}

// Function to clear cookies for a specific platform
export async function clearCookies(platform: Platform) {
  try {
    const keytar = await getKeytar();
    if (keytar) {
      await keytar.deletePassword(APP, platform);
    } else {
      log.warn(`[auth:${platform}] keytar not available; skipping credential deletion.`);
    }
    const platformUrl = `https://www.${platform}.com`;
    await session.defaultSession.clearStorageData({ origin: platformUrl });
    log.info(`[auth:${platform}] Cleared saved cookies and session storage.`);
  } catch (e) {
    const err = e as Error & { message?: string };
    log.error(`[auth:${platform}] Failed to clear cookies:`, err?.message || String(e));
  }
}
