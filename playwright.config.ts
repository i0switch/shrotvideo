import { defineConfig, devices } from '@playwright/test';
import path from 'path';

export default defineConfig({
  
  timeout: 60000,
  retries: 1,
  workers: 1,

  // webServerはElectronアプリを直接起動するため不要
  webServer: {
    command: 'npm run dev',
    url: 'http://127.0.0.1:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 300 * 1000,
    stdout: 'pipe',
    stderr: 'pipe',
  },

  use: {
    headless: true,
    viewport: { width: 1280, height: 800 },
    ignoreHTTPSErrors: true,
    video: 'on-first-retry',
  },

  projects: [
    {
      name: 'Electron', // Electronアプリテスト用
      testDir: './electron/tests', // Electronテストはelectron/testsに配置
      testMatch: /x\.e2e\.test\.ts/, // E2Eテストのみを対象
      use: {
        // Electronアプリの起動はテストファイル内で _electron.launch() を使う
        // ここではダミーのデバイス設定
        ...devices['Desktop Chrome'],
      },
    },
  ],
});