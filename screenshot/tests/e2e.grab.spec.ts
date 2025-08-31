import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { takePostScreenshots } from '../src/grab'; // Import the core logic

const TEST_USER = 'playwright';
const GRAB_COUNT = 5;
const OUTPUT_DIR = path.join(process.cwd(), 'test-out');

test.describe('E2E Grab Logic (Integrated)', () => {

  test.beforeAll(() => {
    // Clean up previous test runs
    if (fs.existsSync(OUTPUT_DIR)) {
      fs.rmSync(OUTPUT_DIR, { recursive: true, force: true });
    }
  });

  test('should grab 5 posts and their metadata', async ({ page }) => {
    // page is authenticated via playwright.config.ts
    await takePostScreenshots(page, {
      user: TEST_USER,
      count: GRAB_COUNT,
      outDir: OUTPUT_DIR,
    });

    const userOutputDir = path.join(OUTPUT_DIR, TEST_USER);
    expect(fs.existsSync(userOutputDir)).toBe(true);

    const files = fs.readdirSync(userOutputDir);
    const screenshotFiles = files.filter(f => f.endsWith('.png'));
    const metaFiles = files.filter(f => f.endsWith('.json'));

    expect(screenshotFiles.length).toBe(GRAB_COUNT);
    expect(metaFiles.length).toBe(GRAB_COUNT);
  });
});
