import { BrowserWindow, session, ipcMain } from 'electron';
import * as keytar from 'keytar';
import log from 'electron-log';

const APP = 'ShortVideoAssistant';

const LOGIN_URL: Record<'x', string> = {
  x: 'https://x.com/login',
};

export async function restoreCookies(platform: string) {
  const raw = await keytar.getPassword(APP, platform);
  if (!raw) return;
  const jar = JSON.parse(raw) as Array<Electron.Cookie>;
  for (const c of jar) {
    // urlプロパティが必要。なければ自動生成（domain/pathから）
    let url = (c as unknown as { url?: string }).url;
    if (!url && c.domain && c.path) {
      url = `https://${c.domain.replace(/^\./, '')}${c.path}`;
    }
    try {
      await session.defaultSession.cookies.set({ ...(c as unknown as Record<string, unknown>), url: url || '' });
    } catch {
      // ignore cookie set failures
    }
  }
}

/**
 * Check whether saved cookies exist for a platform and appear authenticated.
 */
export async function hasSavedCookies(platform: string): Promise<boolean> {
  try {
    const raw = await keytar.getPassword(APP, platform);
    if (!raw) return false;
    const jar = JSON.parse(raw) as Array<Electron.Cookie>;
    if (!Array.isArray(jar) || jar.length === 0) return false;
  // X のみ判定
  const hasAuth = jar.some(c => /(^|\.)x\.com$/i.test((c.domain || '').replace(/^\./, '')) && c.name.toLowerCase() === 'auth_token');
  const hasCt0 = jar.some(c => /(^|\.)x\.com$/i.test((c.domain || '').replace(/^\./, '')) && c.name.toLowerCase() === 'ct0');
  return hasAuth && hasCt0;
  } catch {
    return false;
  }
}

async function captureCookies(platform: string) {
  const all = await session.defaultSession.cookies.get({});
  // フィルタ: プラットフォーム関連ドメイン + 必須名のみ保持してサイズ削減
  const domainAllow: Record<'x', RegExp[]> = {
    x: [/x\.com$/i, /\.x\.com$/i, /twitter\.com$/i, /\.twitter\.com$/i],
  } as const;
  const nameAllow = /auth|ct0|twid|guest_id|kdt|dnt|SAPISID|APISID|SSID|SIDCC|SID|__Secure-3PSID/i;
  const filtered = all.filter(c => {
    const d = c.domain || '';
    const okDomain = (domainAllow as Record<string, RegExp[]>)?.[platform]?.some((re: RegExp) => re.test(d.replace(/^\./, '')));
    const okName = nameAllow.test(c.name);
    return okDomain && okName;
  });
  try {
    const payload = JSON.stringify(filtered);
    await keytar.setPassword(APP, platform, payload);
    log.info(`[auth] stored ${filtered.length}/${all.length} cookies for ${platform}.`);
  } catch (e) {
    const err = e as Error & { message?: string };
    log.warn(`[auth] failed to store cookies for ${platform}: ${err?.message || String(e)}`);
  }
}

export function createLoginWindow(platform: keyof typeof LOGIN_URL) {
  console.info('[auth] open login window:', platform);
  const win = new BrowserWindow({ width: 520, height: 720, webPreferences: { nodeIntegration: false, contextIsolation: true } });
  win.loadURL(LOGIN_URL[platform]);

  let handled = false;

  const cleanup = () => {
    if (handled) return;
    handled = true;
    try {
      win.webContents.removeListener('did-navigate', onNavigate);
      win.webContents.removeListener('did-stop-loading', onStop);
    } catch {
      // ignore
    }
  };

  const successCheck = async (url: string) => {
    if (handled) return;
    let host = '';
    let pathname = '';
    try {
      const u = new URL(url);
      host = u.hostname;
      pathname = u.pathname || '';
    } catch {
      return;
    }
  const okDomain = /x\.com/.test(host);
    if (!okDomain) return;

    const allCookies = await session.defaultSession.cookies.get({});
    let authenticated = false;
  // X のみ: /login系以外のページで x.com の auth_token と ct0 がある
  const onLoginPage = /(^|\/)login/i.test(pathname) || /\/i\/flow\/login/i.test(pathname);
  const hasAuthToken = allCookies.some(c => /(^|\.)x\.com$/i.test((c.domain || '').replace(/^\./, '')) && c.name.toLowerCase() === 'auth_token');
  const hasCt0 = allCookies.some(c => /(^|\.)x\.com$/i.test((c.domain || '').replace(/^\./, '')) && c.name.toLowerCase() === 'ct0');
  if (!onLoginPage && hasAuthToken && hasCt0) authenticated = true;

    if (authenticated) {
      console.info('[auth] login success detected, capturing cookies:', platform);
      // small delay to let site finalize cookies
      await new Promise(res => setTimeout(res, 800));
  try { await captureCookies(platform); } catch (e) { const err = e as Error & { message?: string }; log.warn('[auth] captureCookies error:', err?.message || String(e)); }
      // detach listeners before closing
      cleanup();
  try { if (!win.isDestroyed()) win.close(); } catch { /* noop */ }
    }
  };

  const onNavigate = (_e: Electron.Event, url: string) => { if (!handled) void successCheck(url); };
  const onStop = () => {
    if (handled) return;
    let currentUrl = '';
    try { if (!win.isDestroyed()) currentUrl = win.webContents.getURL(); } catch { /* ignore */ }
    if (currentUrl) void successCheck(currentUrl);
  };

  win.webContents.on('did-navigate', onNavigate);
  win.webContents.on('did-stop-loading', onStop);
  win.on('closed', () => { cleanup(); });
}

ipcMain.handle('auth.login', async (_e, platform: string) => {
  if (platform !== 'x') return; // Xのみ
  createLoginWindow('x');
});
ipcMain.handle('auth.status', async (_e, platform: string) => {
  if (platform !== 'x') return false;
  return hasSavedCookies('x');
});
ipcMain.handle('auth.clear', async (_e, platform: string) => {
  if (platform !== 'x') return false;
  try {
    // Remove cookies from current Electron session for target domains
    const domainAllow: Record<'x', RegExp[]> = {
      x: [/x\.com$/i, /\.x\.com$/i, /twitter\.com$/i, /\.twitter\.com$/i],
    } as const;
    const all = await session.defaultSession.cookies.get({});
    for (const c of all) {
      const d = (c.domain || '').replace(/^\./, '');
      const match = (domainAllow as Record<string, RegExp[]>)['x']?.some((re: RegExp) => re.test(d));
      if (match) {
        try { await session.defaultSession.cookies.remove(`https://${d}${c.path || '/'}`, c.name); } catch { /* swallow */ }
      }
    }
    // Delete from secure storage
    await keytar.deletePassword(APP, 'x');
    log.info(`[auth] cleared saved cookies for x`);
    return true;
  } catch (e) {
    const err = e as Error & { message?: string };
    log.warn(`[auth] failed to clear cookies for x: ${err?.message || String(e)}`);
    return false;
  }
});
console.info('[auth] ipc handler registered: auth.login');
