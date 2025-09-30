import { chromium, Browser, LaunchOptions } from 'playwright';
import path from 'path';
import { createLogger } from '@core/logging/logger';

const logger = createLogger('browser');

export interface BrowserLaunchConfig {
  headless: boolean;
  channel: 'chrome' | 'chromium';
  storageStatePath?: string;
  userDataDir?: string;
}

export async function launchBrowser(config: BrowserLaunchConfig): Promise<Browser> {
  const launchOptions: LaunchOptions = {
    headless: config.headless,
    channel: config.channel === 'chrome' ? 'chrome' : undefined,
    args: [
      '--autoplay-policy=no-user-gesture-required',
      '--ignore-gpu-blocklist',
      '--use-gl=swiftshader'
    ]
  };

  logger.info('Launching browser', launchOptions);
  const browser = await chromium.launch(launchOptions);

  if (config.storageStatePath) {
    const absolutePath = path.resolve(config.storageStatePath);
    logger.info('Using storage state', absolutePath);
  }

  return browser;
}
