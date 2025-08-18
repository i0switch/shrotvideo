import type { Platform } from '#common/settings.js';
import { chromium, Browser, Page } from 'playwright';
import * as keytar from 'keytar';
import log from 'electron-log';

const getService = (platform: Platform) => `com.gemini.shortvideotool.${platform}`;
const getAccount = (platform: Platform) => `${platform}-session`;

const platformConfigs = {
    x: {
        loginUrl: 'https://x.com/login',
        homeUrl: 'https://x.com/home',
    },
    tiktok: {
        loginUrl: 'https://www.tiktok.com/login/phone-or-email',
        homeUrl: 'https://www.tiktok.com/foryou',
    },
    instagram: {
        loginUrl: 'https://www.instagram.com/accounts/login/',
        homeUrl: 'https://www.instagram.com/',
    },
    youtube: {
        loginUrl: 'https://accounts.google.com/',
        homeUrl: 'https://www.youtube.com/',
    }
};

export async function loginWithBrowser(platform: Platform): Promise<boolean> {
    log.info(`[Auth] Starting browser login for ${platform}`);
    const config = platformConfigs[platform];
    if (!config) {
        throw new Error(`Platform configuration not found for ${platform}`);
    }

    let browser: Browser | null = null;
    try {
        browser = await chromium.launch({ headless: false });
        const context = await browser.newContext();
        const page = await context.newPage();

        await page.goto(config.loginUrl);

        log.info(`[Auth] Waiting for user to log in and be redirected to a URL including: ${config.homeUrl}`);

        // Wait for successful login navigation
        await page.waitForURL(`**${config.homeUrl}**`, { timeout: 300000 }); // 5 minute timeout

        log.info(`[Auth] Login successful for ${platform}. Saving session...`);

        const cookies = await context.cookies();
        const cookieString = JSON.stringify(cookies);

        const service = getService(platform);
        const account = getAccount(platform);
        await keytar.setPassword(service, account, cookieString);

        log.info(`[Auth] Session for ${platform} saved successfully.`);

        await browser.close();
        return true;

    } catch (error: any) {
        log.error(`[Auth] Login process for ${platform} failed or was cancelled.`, error.message);
        if (browser) {
            await browser.close();
        }
        return false;
    }
}

export async function logout(platform: Platform): Promise<boolean> {
    log.info(`[Auth] Logging out from ${platform}`);
    const service = getService(platform);
    const account = getAccount(platform);
    try {
        return await keytar.deletePassword(service, account);
    } catch (error) {
        log.error(`[Auth] Failed to delete session for ${platform}`, error);
        return false;
    }
}

export async function checkLoginStatus(platform: Platform): Promise<boolean> {
    log.info(`[Auth] Checking login status for ${platform}`);
    const cookies = await getCookies(platform);
    return cookies !== null && cookies.length > 0;
}

export async function getCookies(platform: Platform): Promise<string | null> {
    const service = getService(platform);
    const account = getAccount(platform);
    return keytar.getPassword(service, account);
}
