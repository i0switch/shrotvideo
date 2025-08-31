import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import log from 'electron-log';
import * as keytar from 'keytar';

// Use shared Platform type to avoid circular deps with electron/login
import type { Platform } from '../../src/core/settings.js';

export const APP = 'ShortVideoAssistant';

// Netscape形式のCookieファイル文字列を生成
export function toNetscapeCookie(cookies: Electron.Cookie[]): string {
    let str = '# Netscape HTTP Cookie File\n';
    for (const c of cookies) {
        if (!c.domain) continue; // domainがないCookieはスキップ
        str += [
            c.domain,
            c.domain.startsWith('.') ? 'TRUE' : 'FALSE',
            c.path || '/',
            String(c.secure).toUpperCase(),
            c.expirationDate ? Math.round(c.expirationDate) : 0,
            c.name,
            c.value
        ].join('\t') + '\n';
    }
    return str;
}

// Create a temporary Netscape-format cookie file from saved cookies for platforms that benefit from login
export async function createCookieFileIfAny(platform: Platform): Promise<string | undefined> {
  if (platform !== 'youtube' && platform !== 'tiktok') return undefined;
  try {
    const raw = await keytar.getPassword(APP, platform);
    if (!raw) {
      log.info(`[cookie-utils:${platform}] No raw credentials found in keystore.`);
      return undefined;
    }
    const cookies = JSON.parse(raw) as Electron.Cookie[];
    if (!Array.isArray(cookies) || cookies.length === 0) {
      log.info(`[cookie-utils:${platform}] No cookies found for platform.`);
      return undefined;
    }
    const p = path.join(os.tmpdir(), `cookies-${platform}-${Date.now()}.txt`);
    const cookieContent = toNetscapeCookie(cookies);
    await fs.writeFile(p, cookieContent);
    log.info(`[cookie-utils:${platform}] Created cookie file at ${p}`);
    log.info(`[cookie-utils:${platform}] DEBUG: Cookie file content (first 200 chars):\n${cookieContent.substring(0, 200)}`);
    return p;
  } catch (e) {
    log.error(`[cookie-utils:${platform}] Failed to create cookie file.`, e);
    return undefined;
  }
}
