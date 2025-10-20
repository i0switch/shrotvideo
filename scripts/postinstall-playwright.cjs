#!/usr/bin/env node
'use strict';

/**
 * Ensure Playwright Chromium is installed into project-local .local-browsers
 * so that electron-builder can package it (we include node_modules/playwright-core/**).
 * This avoids relying on cross-env and works on Windows PowerShell.
 */

const { spawn } = require('child_process');
const path = require('path');

function run() {
  return new Promise((resolve) => {
    let cliJs = null;
    try {
      const pkg = require.resolve('playwright-core/package.json');
      cliJs = path.join(path.dirname(pkg), 'cli.js');
    } catch {}
    if (!cliJs) {
      console.warn('[postinstall-playwright] playwright-core not found; skipping');
      return resolve(true);
    }
  const env = { ...process.env, PLAYWRIGHT_BROWSERS_PATH: '0' };
  // Install both chromium and chromium-headless-shell to match runtime expectations in v1.55+
  const child = spawn(process.execPath, [cliJs, 'install', 'chromium', 'chromium-headless-shell'], { stdio: 'inherit', env });
    child.on('close', (code) => resolve(code === 0));
    child.on('error', () => resolve(false));
  });
}

(async () => {
  const ok = await run();
  if (!ok) {
    console.warn('[postinstall-playwright] failed to install Chromium. You can run manually: PLAYWRIGHT_BROWSERS_PATH=0 npx playwright install chromium');
  }
})();
