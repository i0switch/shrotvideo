import { Page } from 'playwright';
import path from 'path';
import { createLogger } from '@core/logging/logger';
import { ensureDir } from '@core/utils/paths';

const logger = createLogger('screenshot');

export interface ScreenshotOptions {
  selector: string;
  outDir: string;
  filename: string;
}

export interface ClipRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ScreenshotResult {
  path: string;
  clip?: ClipRect;
}

export async function captureRegion(page: Page, options: ScreenshotOptions): Promise<ScreenshotResult> {
  const { selector, outDir, filename } = options;
  const resolvedSelector = selector.trim().startsWith('/') || selector.trim().startsWith('(')
    ? `xpath=${selector}`
    : selector;

  const locator = page.locator(resolvedSelector);
  await locator.waitFor({ state: 'visible', timeout: 30_000 });
  const element = await locator.elementHandle();
  if (!element) {
    logger.warn('Selector not found, taking full page screenshot');
    ensureDir(outDir);
    const fullPath = path.join(outDir, filename);
    await page.screenshot({ path: fullPath, fullPage: true });
    return { path: fullPath };
  }

  const clip = await element.boundingBox();
  ensureDir(outDir);
  const screenshotPath = path.join(outDir, filename);
  await page.screenshot({ path: screenshotPath, clip: clip ?? undefined });
  return { path: screenshotPath, clip: clip ?? undefined };
}
