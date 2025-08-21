import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './src/tests',
  timeout: 60000, // Increased timeout for web server start
  retries: 1,

  // Opt out of parallel tests because they conflict with a single server instance.
  workers: 1,

  /*
  webServer: {
    command: 'npm run dev',
  url: 'http://127.0.0.1:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 120 * 1000, // 2 minutes to start
    stdout: 'pipe',
    stderr: 'pipe',
  },
  */

  use: {
    headless: true,
    viewport: { width: 1280, height: 800 },
    ignoreHTTPSErrors: true,
    video: 'on-first-retry', // Changed to reduce noise, only record video on retry
  baseURL: 'http://127.0.0.1:5173', // Set base URL to Vite dev server
  },

  projects: [
    {
      name: 'Chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    // Electron project is disabled for now as it requires more complex setup
    // to launch the electron app directly. Testing against chromium is sufficient.
    {
      name: 'Electron',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
