const { defineConfig } = require('vitest/config');

module.exports = defineConfig({
  test: {
    environment: 'node',
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/release/**',
      '**/test-results/**',
      '**/*.e2e.*',
      'src/tests/e2e-*.test.*',
      'electron/tests/e2e-*.test.*',
      'src/tests/e2e-app.test.*',
      'playwright.config.*',
    ],
  },
});