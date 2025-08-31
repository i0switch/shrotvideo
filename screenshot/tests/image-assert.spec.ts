import { test, expect } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';
import { createHash } from 'crypto';
import { takePostScreenshots } from '../src/grab'; // Import the core logic

const TEST_USER = 'playwright';
const OUTPUT_DIR = path.join(process.cwd(), 'test-out-img-assert');

test.describe('Text Hash Assertion (Integrated)', () => {

  test.beforeAll(() => {
    // Clean up previous test runs
    if (fs.existsSync(OUTPUT_DIR)) {
      fs.rmSync(OUTPUT_DIR, { recursive: true, force: true });
    }
  });

  test('should have matching text hash for the captured post', async ({ page }) => {
    // 1. Grab the post and metadata using the core function
    await takePostScreenshots(page, {
      user: TEST_USER,
      count: 1,
      outDir: OUTPUT_DIR,
    });

    // 2. Read the generated metadata
    const userOutputDir = path.join(OUTPUT_DIR, TEST_USER);
    const capturedFiles = fs.readdirSync(userOutputDir);
    const jsonFile = capturedFiles.find(f => f.endsWith('.json'));
    expect(jsonFile, 'Metadata JSON file should have been created').toBeDefined();

    const metaPath = path.join(userOutputDir, jsonFile!);
    const metadata = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
    const { tweetId, textHash: originalHash } = metadata;

    expect(tweetId, 'Tweet ID must be in metadata').toBeDefined();
    expect(originalHash, 'Text hash must be in metadata').toBeDefined();

    // 3. Navigate to the post's URL and verify the hash
    const tweetUrl = `https://x.com/${TEST_USER}/status/${tweetId}`;
    await page.goto(tweetUrl);
    await page.waitForSelector('[data-testid="tweetText"]');

    const tweetTextElement = await page.locator('[data-testid="tweetText"]').first();
    const onPageText = await tweetTextElement.textContent() || '';
    const onPageHash = createHash('sha256').update(onPageText).digest('hex');

    expect(onPageHash).toBe(originalHash);
  });
});
