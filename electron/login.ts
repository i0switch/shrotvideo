import { ipcMain, BrowserWindow, session } from 'electron';
import type { Cookie } from 'electron';
import log from 'electron-log';
import { saveCookies, clearCookies } from './auth-utils';

const APP = 'ShortVideoAssistant';

// Supported platforms
export type Platform = 'x' | 'youtube' | 'tiktok';

const LOGIN_URL: Record<Platform, string> = {
  x: 'https://x.com/login',
  youtube: 'https://accounts.google.com/ServiceLogin?service=youtube',
  tiktok: 'https://www.tiktok.com/login/phone-or-email',
};

const PLATFORM_SETTINGS: Record<Platform, {
  domains: RegExp[];
  cookieNames: RegExp;
  isLoggedIn: (cookies: Cookie[], url: string) => boolean;
}> = {
  x: {
    domains: [/x\.com$/i, /twitter\.com$/i],
    cookieNames: /auth_token|ct0|twid/i,
    isLoggedIn: (cookies, url) => {
      const u = new URL(url);
      const onLoginPage = /(^|\/)login/i.test(u.pathname);
      const hasAuthToken = cookies.some(c => c.name.toLowerCase() === 'auth_token' && !!c.value);
      const hasCt0 = cookies.some(c => c.name.toLowerCase() === 'ct0' && !!c.value);
      return !onLoginPage && hasAuthToken && hasCt0;
    }
  },
  youtube: {
    domains: [/youtube\.com$/i, /google\.com$/i, /accounts\.google\.com$/i],
    cookieNames: /SID|HSID|SSID|APISID|SAPISID|LOGIN_INFO/i,
    isLoggedIn: (cookies, url) => {
      const u = new URL(url);
      const onLoginPage = u.hostname.includes('accounts.google.com');
      const hasLoginInfo = cookies.some(c => (c.domain || '') === '.youtube.com' && c.name === 'LOGIN_INFO');
      const hasSapisid = cookies.some(c => (c.domain || '').endsWith('.google.com') && c.name === 'SAPISID' && c.value && c.value.length > 5);
      return !onLoginPage && hasLoginInfo && hasSapisid;
    }
  },
  tiktok: {
    domains: [/tiktok\.com$/i],
    cookieNames: /sessionid|tt_webid_v2/i,
    isLoggedIn: (cookies, url) => {
      const u = new URL(url);
      const onLoginPage = u.pathname.includes('login');
      const hasSessionId = cookies.some(c => (c.domain || '') === '.tiktok.com' && c.name === 'sessionid' && c.value && c.value.length > 5);
      return !onLoginPage && hasSessionId;
    }
  }
};

export async function hasSavedCookies(platform: Platform): Promise<boolean> {
  try {
    // keytar may be unavailable on some systems; load dynamically
    let keytar: any = null;
    try { keytar = await import('keytar'); } catch { keytar = null; }
    if (!keytar) return false;
    const raw = await keytar.getPassword(APP, platform);
    if (!raw) return false;
    const jar = JSON.parse(raw) as Array<Cookie>;
    if (!Array.isArray(jar) || jar.length === 0) return false;

    switch (platform) {
      case 'x':
        const hasAuthToken = jar.some(c => c.name.toLowerCase() === 'auth_token' && c.value);
        const hasCt0 = jar.some(c => c.name.toLowerCase() === 'ct0' && c.value);
        return hasAuthToken && hasCt0;
      case 'youtube':
        const hasLoginInfo = jar.some(c => (c.domain || '') === '.youtube.com' && c.name === 'LOGIN_INFO' && c.value);
        const hasSapisid = jar.some(c => (c.domain || '').endsWith('.google.com') && c.name === 'SAPISID' && c.value && c.value.length > 5);
        return hasLoginInfo && hasSapisid;
      case 'tiktok':
        return jar.some(c => (c.domain || '') === '.tiktok.com' && c.name === 'sessionid' && c.value && c.value.length > 5);
      default:
        return false;
    }
  } catch {
    return false;
  }
}

async function captureCookies(platform: Platform) {
  const all = await session.defaultSession.cookies.get({});
  const settings = PLATFORM_SETTINGS[platform];
  
  const filtered = all.filter(c => {
    const domain = (c.domain || '').replace(/^\./, '');
    const isPlatformDomain = settings.domains.some(re => re.test(domain));
    const isAllowedName = settings.cookieNames.test(c.name);
    return isPlatformDomain && isAllowedName;
  });

  await saveCookies(platform, filtered);
}

export function createLoginWindow(platform: Platform) {
  log.info(`[auth:${platform}] Opening login window.`);
  const win = new BrowserWindow({ width: 520, height: 720, webPreferences: { nodeIntegration: false, contextIsolation: true } });
  win.loadURL(LOGIN_URL[platform]);

  let handled = false;
  const cleanup = () => {
    if (handled) return;
    handled = true;
    try {
      win.webContents.removeListener('did-navigate', onNavigate);
      win.webContents.removeListener('did-stop-loading', onStop);
    } catch {}
  };

  const successCheck = async (url: string) => {
    if (handled) return;
    const settings = PLATFORM_SETTINGS[platform];
    const allCookies = await session.defaultSession.cookies.get({});
    
    if (settings.isLoggedIn(allCookies, url)) {
      log.info(`[auth:${platform}] Login success detected, capturing cookies.`);
      await new Promise(res => setTimeout(res, 800));
      await captureCookies(platform);
      cleanup();
      if (!win.isDestroyed()) win.close();
    }
  };

  const onNavigate = (_e: Electron.Event, url: string) => { if (!handled) void successCheck(url); };
  const onStop = () => {
    if (handled) return;
    try {
      if (!win.isDestroyed()) void successCheck(win.webContents.getURL());
    } catch {}
  };

  win.webContents.on('did-navigate', onNavigate);
  win.webContents.on('did-stop-loading', onStop);
  win.on('closed', cleanup);
}

// --- IPC Handlers ---
ipcMain.handle('auth.login', async (_e, platform: Platform) => {
  if (!LOGIN_URL[platform]) return;
  createLoginWindow(platform);
});

ipcMain.handle('auth.status', async (_e, platform: Platform) => {
  if (!PLATFORM_SETTINGS[platform]) return false;
  return hasSavedCookies(platform);
});

ipcMain.handle('auth.clear', async (_e, platform: Platform) => {
  if (!PLATFORM_SETTINGS[platform]) return false;
  return clearCookies(platform);
});

log.info('[auth] IPC handlers registered for login, status, clear.');
