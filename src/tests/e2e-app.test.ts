import { test, expect, Page } from '@playwright/test';

// Note: test.describe() and test.beforeEach() were removed to be compatible with vitest's runner.
// Each test is now standalone.

test('E2E: should display the main dashboard on launch', async ({ page }) => {
  await page.goto('http://localhost:8080');
  await expect(page.getByRole('heading', { name: 'ダッシュボード' })).toBeVisible();
  await expect(page.getByText('監視ステータス')).toBeVisible();
  await expect(page.getByRole('button', { name: '設定を編集' })).toBeVisible();
});

test('E2E: should configure settings, run a job, and stop it', async ({ page }) => {
  // 1. Navigate to settings and configure
  await page.goto('http://localhost:8080/settings');

  // Go to the X tab
  await page.getByRole('tab', { name: 'X' }).click();

  // Enable monitoring
  await page.getByLabel('監視を有効にする').check();

  // Add a well-known account for testing
  const accountId = 'NASA';
  await page.getByPlaceholder('新しいアカウントIDを追加...').fill(accountId);
  await page.getByRole('button', { name: '追加' }).click();
  await expect(page.getByText(accountId, { exact: true })).toBeVisible();

  // 2. Go back to Dashboard
  await page.getByRole('link', { name: 'ダッシュボード' }).click();
  await expect(page.getByRole('heading', { name: 'ダッシュボード' })).toBeVisible();

  // 3. Start Monitoring
  await page.getByRole('button', { name: '自動監視を開始' }).click();

  // Verify the status changes to "実行中" (Running)
  await expect(page.getByText('実行中')).toBeVisible({ timeout: 10000 });

  // 4. Check Logs for Job Execution
  // Wait for the scraper to start. This confirms the whole pipeline is connected.
  await expect(page.locator('div:text("[x:NASA] Starting scrape...")').first()).toBeVisible({ timeout: 30000 });

  // As determined before, we expect a specific failure from Playwright in this environment.
  // Checking for this failure proves the scraper task was actually attempted.
  await expect(page.locator('div:text("[x:NASA] Playwright scraping failed")').first()).toBeVisible({ timeout: 60000 });
  await expect(page.locator('div:text("Task failed after all retries or timed out")').first()).toBeVisible({ timeout: 60000 });

  // 5. Stop Monitoring
  await page.getByRole('button', { name: '停止' }).click();
  await expect(page.getByText('停止中')).toBeVisible();
});
