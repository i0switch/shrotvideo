import { test, expect, Page } from '@playwright/test';

/**
 * E2E tests for the basic application rendering and navigation.
 * NOTE: These tests run against the web server (`vite dev`) and do not have access
 * to the Electron-specific `window.electronAPI`. Therefore, any functionality
 * depending on IPC (like starting jobs or receiving logs) cannot be tested here.
 * The purpose of these tests is to ensure the React application can render all pages
 * without crashing.
 */

test.describe('Application Page Rendering', () => {
  test.beforeEach(async ({ page }) => {
    // Add listeners to catch any unexpected console errors during page load
    page.on('console', msg => {
      if (msg.type() === 'error') {
        console.log(`Browser Console ERROR: ${msg.text()}`);
      }
    });
    page.on('pageerror', exception => {
      console.log(`Uncaught exception in page: "${exception.message}"`);
    });
  });

  test('should display the Dashboard page', async ({ page }) => {
    await page.goto('/');
    // Check for a unique and stable element on the dashboard page.
    await expect(page.getByRole('heading', { name: '自動監視コントロール' })).toBeVisible({ timeout: 15000 });
    await expect(page.getByRole('button', { name: '設定を編集' })).toBeVisible();
  });

  test('should navigate to and display the Settings page', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: '設定を編集' }).click();

    await expect(page).toHaveURL(/.*settings/);
    // Check for a unique and stable element on the settings page.
    // Use level: 1 to specify the <h1> tag and ensure uniqueness.
    await expect(page.getByRole('heading', { name: '設定', level: 1 })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'X' })).toBeVisible();
  });

  test('should navigate to and display the Help page', async ({ page }) => {
    await page.goto('/');
    // In AppLayout, nav items are links. We find the correct one by its title.
    await page.getByRole('link', { name: 'ヘルプ' }).click();

    await expect(page).toHaveURL(/.*help/);
    await expect(page.getByRole('heading', { name: 'ヘルプ' })).toBeVisible();
  });

  test('should navigate to and display the Setup page on manual navigation', async ({ page }) => {
    await page.goto('/setup');

    await expect(page).toHaveURL(/.*setup/);
    await expect(page.getByRole('heading', { name: '初期セットアップ' })).toBeVisible();
    // Check that the "Go to Dashboard" button appears after checks complete.
    await expect(page.getByRole('button', { name: 'ダッシュボードへ' })).toBeVisible({ timeout: 30000 });
  });
});
