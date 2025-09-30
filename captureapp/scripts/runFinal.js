#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-var-requires */
const fs = require('fs');
const path = require('path');

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function resolveSelector(defaultSelector) {
  const selectorFile = path.resolve(__dirname, '..', 'x.txt');
  if (fs.existsSync(selectorFile)) {
    return fs.readFileSync(selectorFile, 'utf-8').split('\n').filter(Boolean).pop() || defaultSelector;
  }
  return defaultSelector;
}

function parseArgs(argv) {
  const parsed = {
    handle: 'kandounekodouga',
    count: 10,
    selector: undefined,
    out: undefined,
    headless: false,
    parallel: 2,
    browser: 'chrome',
    storageState: path.resolve(process.cwd(), 'storageState.json')
  };

  for (let index = 2; index < argv.length; index++) {
    const arg = argv[index];
    if (!arg.startsWith('--')) {
      continue;
    }
    const key = arg.slice(2);
    const value = argv[index + 1];

    switch (key) {
      case 'handle':
        parsed.handle = value;
        index++;
        break;
      case 'count':
        parsed.count = Number(value);
        index++;
        break;
      case 'selector':
        parsed.selector = value;
        index++;
        break;
      case 'out':
        parsed.out = value;
        index++;
        break;
      case 'parallel':
        parsed.parallel = Number(value);
        index++;
        break;
      case 'browser':
        parsed.browser = value;
        index++;
        break;
      case 'headless':
        parsed.headless = value === 'true' || value === '1';
        index++;
        break;
      case 'storageState':
        parsed.storageState = path.resolve(value);
        index++;
        break;
      default:
        break;
    }
  }

  return parsed;
}

async function main() {
  const args = parseArgs(process.argv);
  const defaultSelector = '/html/body/div[1]/div/div/div[2]/main/div/div/div/div/div/section/div/div/div[1]/div/div/article';
  const selector = args.selector ?? resolveSelector(defaultSelector);
  const outDir = path.resolve(args.out ?? path.join('outputs', `final_run_${new Date().toISOString().slice(0, 10).replace(/-/g, '')}`));

  const runnerModulePath = path.resolve(__dirname, '..', 'dist', 'main', 'app', 'core', 'x', 'runner.js');
  if (!fs.existsSync(runnerModulePath)) {
    console.error('Runner module not found. Please run "npm run build:main" first.');
    process.exit(1);
  }

  const { runCapture } = require(runnerModulePath);

  const summary = await runCapture({
    handle: args.handle,
    count: args.count,
    selector,
    outDir,
    headless: args.headless,
    parallel: args.parallel,
    browserChannel: args.browser === 'chrome' ? 'chrome' : 'chromium',
    storageStatePath: args.storageState
  });

  const reportsDir = path.join(summary.outputsDir, '_reports');
  ensureDir(reportsDir);

  const report = {
    generatedAt: new Date().toISOString(),
    handle: summary.handle,
    total: summary.total,
    success: summary.success,
    partial: summary.partial,
    failed: summary.failed,
    outputsDir: summary.outputsDir,
    results: summary.results.map((result) => ({
      tweetId: result.target.tweetId,
      status: result.status,
      classification: result.classification.kind,
      errors: result.errors,
      screenshotPath: result.screenshotPath,
      videoPath: result.videoPath,
      compositedPath: result.compositedPath,
      metaPath: result.metaPath
    }))
  };

  const htmlReport = `<!doctype html>
<html lang="ja">
  <head>
    <meta charset="utf-8" />
    <title>CaptureApp Final Report</title>
    <style>
      body { font-family: 'Segoe UI', sans-serif; margin: 32px; background: #f8fafc; color: #111827; }
      h1 { color: #312e81; }
      table { width: 100%; border-collapse: collapse; margin-top: 24px; }
      th, td { padding: 12px 16px; border-bottom: 1px solid rgba(99,102,241,0.2); text-align: left; }
      th { background: rgba(79,70,229,0.1); }
      tr.success { background: rgba(34,197,94,0.08); }
      tr.partial { background: rgba(250,204,21,0.12); }
      tr.failed { background: rgba(248,113,113,0.12); }
    </style>
  </head>
  <body>
    <h1>CaptureApp 最終レポート</h1>
    <p>対象アカウント: @${summary.handle}</p>
    <p>合計: ${summary.total} / 成功: ${summary.success} / 部分成功: ${summary.partial} / 失敗: ${summary.failed}</p>
    <table>
      <thead>
        <tr>
          <th>Tweet ID</th>
          <th>分類</th>
          <th>ステータス</th>
          <th>スクリーンショット</th>
          <th>動画</th>
          <th>合成動画</th>
          <th>エラー</th>
        </tr>
      </thead>
      <tbody>
        ${summary.results
          .map((result) => `
            <tr class="${result.status}">
              <td>${result.target.tweetId}</td>
              <td>${result.classification.kind}</td>
              <td>${result.status}</td>
              <td>${fs.existsSync(result.screenshotPath) ? '✅' : '❌'}</td>
              <td>${result.videoPath && fs.existsSync(result.videoPath) ? '✅' : '-'}</td>
              <td>${result.compositedPath && fs.existsSync(result.compositedPath) ? '✅' : '-'}</td>
              <td>${result.errors.join('; ')}</td>
            </tr>`)
          .join('')}
      </tbody>
    </table>
  </body>
</html>`;

  fs.writeFileSync(path.join(reportsDir, 'test-report.json'), JSON.stringify(report, null, 2), 'utf-8');
  fs.writeFileSync(path.join(reportsDir, 'test-report.html'), htmlReport, 'utf-8');

  console.log('✅ Capture completed. Summary saved to', summary.outputsDir);
  console.log('Run metadata:', path.join(summary.outputsDir, 'run_meta.json'));
  console.log('Reports available at:', reportsDir);
}

main().catch((error) => {
  console.error('Capture run failed:', error);
  process.exitCode = 1;
});
