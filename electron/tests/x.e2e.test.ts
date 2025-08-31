import { test, expect, _electron, Page } from '@playwright/test';
import fs from 'fs';

test.describe('X Scraper E2E', () => {
  let electronApp: any;

  test.beforeAll(async () => {
    electronApp = await _electron.launch({
      args: ['C:/Users/i0swi/OneDrive/デスクトップ/dougadownload/electron-entry.cjs'],
  env: { NODE_ENV: 'development', RUN_TEST_EXIT: '0', E2E: '1' },
    });
  });

  test.afterAll(async () => {
    await electronApp.close();
  });

  test('should scrape an X profile and return a screenshot path', async () => {
    const accountId = 'elonmusk';
    // Prefer the app renderer window, not DevTools
    const page = await (async () => {
      // If DevTools is opened, firstWindow might be DevTools. Pick the renderer by URL or by presence of preload API.
      const deadline = Date.now() + 60000; // 60s
      while (Date.now() < deadline) {
        const windows: Page[] = await electronApp.windows();
        // Try URL-based selection first
        for (const w of windows) {
          const url = w.url();
          if (url.includes('127.0.0.1:5173') || url.endsWith('/index.html')) {
            return w;
          }
        }
        // Fallback: pick any window that exposes electronAPI
        for (const w of windows) {
          try {
            const ok = await w.evaluate(() => !!((window as any).electronAPI));
            if (ok) return w;
          } catch {
            // ignore cross-target races
          }
        }
        // Wait for a new window event, then loop
        try {
          await electronApp.waitForEvent('window', { timeout: 2000 });
        } catch {
          // no new window, small delay
          await new Promise((r) => setTimeout(r, 250));
        }
      }
      throw new Error('Renderer window not found');
    })();

    // Ensure renderer is loaded before accessing preload-exposed APIs
    await page.waitForLoadState('domcontentloaded');
    await page.waitForFunction(() => !!((window as any).electronAPI && (window as any).electronAPI.testScrapeX), undefined, { timeout: 60000 });
    const screenshotPath = await page.evaluate(async (accountId) => {
      return await (window as any).electronAPI.testScrapeX(accountId);
    }, accountId);

    expect(screenshotPath).not.toBeNull();
    expect(typeof screenshotPath).toBe('string');
    expect(fs.existsSync(screenshotPath!)).toBe(true);
  });
});