import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    trace: 'on-first-retry',
    browserName: 'chromium',
    headless: true,
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
    locale: 'ja-JP',
    colorScheme: 'light',
    storageState: '.auth/x.storage.json',
    launchOptions: {
      args: ['--disable-gpu', '--disable-animations'],
    },
  },
  projects: [
    {
      name: 'chromium',
    },
  ],
});
