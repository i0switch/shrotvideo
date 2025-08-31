import { test, expect, _electron } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

test.describe('Login E2E Test', () => {
  let electronApp: any;
  let page: any;

  test.beforeAll(async () => {
    // Get the directory of the current test file
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);

    electronApp = await _electron.launch({
      
      args: [
        path.join(__dirname, '../../electron-entry.cjs'),
      ],
      env: { NODE_ENV: 'development', RUN_TEST_ON_START: '1' }, // Add this line
    });
    page = await electronApp.firstWindow();

    // Wait for the app to be ready
    await page.waitForLoadState('domcontentloaded');
  });

  test.afterAll(async () => {
    await electronApp.close();
  });

  test('should successfully log in to X and save credentials', async () => {
    // Navigate to settings page
    await page.goto('#/settings');

    // Click on the X tab
    await page.getByRole('tab', { name: 'X' }).click();

    // Click the login button
    await page.getByRole('button', { name: 'X (旧Twitter) 公式ログイン画面を表示' }).click();

    // Wait for the login window to appear
    const loginWindow = await electronApp.waitForEvent('window');
    await loginWindow.waitForLoadState('domcontentloaded');

    // Fill in login credentials
    // Note: These selectors might need adjustment based on the actual X login page structure
    await loginWindow.fill('input[name="text"]', 'rinnmamas2'); // Username/Email
    await loginWindow.getByRole('button', { name: '次へ' }).click();

    // Handle potential password or 2FA step
    // This part is highly dependent on X's login flow and might require more robust handling
    // For simplicity, assuming it directly asks for password after username
    await loginWindow.fill('input[name="password"]', 'pasowota427314t'); // Password
    await loginWindow.getByRole('button', { name: 'ログイン' }).click();

    // Wait for the login window to close (indicating successful login and cookie capture)
    await loginWindow.waitForEvent('close');

    // Verify login status in the main app window
    await expect(page.getByText('ログイン済み')).toBeVisible();

    // Verify cookies are saved via IPC (requires a new IPC handler in main process)
    const cookieSaved = await page.evaluate(() => window.auth.status('x'));
    expect(cookieSaved).toBe(true);

    // Optional: Verify authenticated access by trying to scrape a protected page
    // This would require mocking the scraper or having a testable endpoint
    // For now, we rely on the cookieSaved status and the login window closing.
  });
});
