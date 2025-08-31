import { chromium, BrowserContext } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';

const STORAGE_STATE_PATH = path.join(process.cwd(), '.auth', 'x.storage.json');

/**
 * Ensures the user is logged in.
 * If storage state exists, it's considered logged in.
 * Otherwise, it launches a headful browser for the user to log in.
 * @returns {Promise<string>} The path to the storage state file.
 */
export async function ensureLogin(): Promise<string> {
  if (fs.existsSync(STORAGE_STATE_PATH)) {
    console.log('Storage state found. Assuming logged in.');
    // TODO: Add validation to check if the cookie is still valid
    return STORAGE_STATE_PATH;
  }

  console.log('Storage state not found. Please log in to X.');
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    await page.goto('https://x.com/i/flow/login');

    // Wait for the user to complete the login process.
    // A simple way is to wait for a specific element that only appears after login,
    // or just wait for a long time.
    console.log('Please complete the login process in the browser. The browser will close automatically when you navigate away from the login page or after 5 minutes.');
    await page.waitForURL((url) => !url.pathname.includes('login'), { timeout: 300000 }); // 5 minutes timeout

    console.log('Login successful. Saving storage state...');
    const storageState = await context.storageState();
    fs.mkdirSync(path.dirname(STORAGE_STATE_PATH), { recursive: true });
    fs.writeFileSync(STORAGE_STATE_PATH, JSON.stringify(storageState, null, 2));
    console.log(`Storage state saved to ${STORAGE_STATE_PATH}`);

    return STORAGE_STATE_PATH;
  } catch (error) {
    console.error('Login process failed:', error);
    throw new Error('Failed to log in and save storage state.');
  } finally {
    await browser.close();
  }
}
