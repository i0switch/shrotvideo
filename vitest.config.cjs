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
      // Integration tests hit network/ffmpeg/electron; exclude for unit runs
      '**/*.integration.test.*',
      'electron/tests/run-*.ts',
      'src/tests/e2e-*.test.*',
      'electron/tests/e2e-*.test.*',
      'src/tests/e2e-app.test.*',
      // Playwright系やスクリーンショット検証はVitestの対象外
      'screenshot/**',
      // ネストされた重複ワークスペース配下は除外
      'shrotvideo/**',
      'playwright.config.*',
    ],
  },
});