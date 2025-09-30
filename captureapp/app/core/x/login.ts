import fs from 'fs';
import { BrowserContext } from 'playwright';
import path from 'path';
import { createLogger } from '@core/logging/logger';

interface StorageStateSnapshot {
  cookies?: unknown[];
  origins?: Array<{ origin: string; localStorage?: Array<{ name: string; value: string }> }>;
  localStorage?: Record<string, string>;
}

const logger = createLogger('login');

export interface LoginOptions {
  storageStatePath: string;
  headless: boolean;
}

export async function loadStorageState(context: BrowserContext, storageStatePath: string) {
  if (fs.existsSync(storageStatePath)) {
    logger.info('Applying storage state', storageStatePath);
    await context.addInitScript(({ state }: { state: StorageStateSnapshot }) => {
      window.localStorage.clear();
      Object.entries(state.localStorage || {}).forEach(([key, value]) => {
        window.localStorage.setItem(key, value as string);
      });
    }, { state: JSON.parse(fs.readFileSync(storageStatePath, 'utf-8')) });
  }
}

export async function ensureLoggedIn(context: BrowserContext, options: LoginOptions): Promise<void> {
  const { storageStatePath } = options;
  fs.mkdirSync(path.dirname(storageStatePath), { recursive: true });

  if (fs.existsSync(storageStatePath)) {
    logger.info('Reusing existing storage state');
    await context.storageState({ path: storageStatePath });

    const cookies = await context.cookies('https://x.com');
    const hasAuthToken = cookies.some((cookie) => cookie.name === 'auth_token');
    const hasCsrf = cookies.some((cookie) => cookie.name === 'ct0');

    if (hasAuthToken && hasCsrf) {
      logger.info('Storage state already contains authenticated cookies');
      return;
    }

    logger.warn('Existing storage state is missing authentication cookies', {
      hasAuthToken,
      hasCsrf
    });

    if (options.headless) {
      throw new Error(
        'ログイン済みの storageState.json が必要です。`--headless false` で起動し、X にログインしてから再実行してください。'
      );
    }
  }

  const page = await context.newPage();
  await page.goto('https://x.com/login', { waitUntil: 'networkidle' });
  logger.info('Waiting for user login via GUI window');

  const deadline = Date.now() + 5 * 60 * 1000;
  let lastLog = 0;

  while (Date.now() < deadline) {
    const cookies = await context.cookies('https://x.com');
    const hasAuthToken = cookies.some((cookie) => cookie.name === 'auth_token');
    const hasCsrf = cookies.some((cookie) => cookie.name === 'ct0');

    if (hasAuthToken && hasCsrf) {
      logger.info('Detected authenticated session cookies, persisting storage state');
      const state = await context.storageState({ path: storageStatePath });
      logger.info('Stored new session to', path.resolve(storageStatePath), state.origins.length);
      await page.close();
      return;
    }

    const now = Date.now();
    if (now - lastLog > 15_000) {
      lastLog = now;
      logger.info('Still waiting for login completion, no auth cookies yet', {
        currentUrl: page.url()
      });
    }

    await page.waitForTimeout(1000);
  }

  throw new Error('制限時間内にログインを確認できませんでした。ログイン後に再度お試しください。');
}
