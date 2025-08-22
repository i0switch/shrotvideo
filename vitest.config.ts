import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/release/**',
      '**/test-results/**',
  // Playwright製のE2EはVitestから除外
  '**/*.e2e.*',
  'src/tests/e2e-*.test.*',
  'electron/tests/e2e-*.test.*',
  'src/tests/e2e-app.test.*',
      'playwright.config.*',
    ],
  },
});
