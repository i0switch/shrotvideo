const { defineConfig } = require('vitest/config');

module.exports = defineConfig({
  test: {
    environment: 'node',
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/release/**',
      '**/test-results/**',
      // E2E/Playwright などは除外
      '**/*.e2e.*',
      'electron/tests/run-*.ts',
      'src/tests/e2e-*.test.*',
      'electron/tests/e2e-*.test.*',
      'src/tests/e2e-app.test.*',
      'screenshot/**',
      'captureapp/**',
      'shrotvideo/**',
      'playwright.config.*',
    ],
    testTimeout: 180_000,
  },
});
