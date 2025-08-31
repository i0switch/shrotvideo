import Store from 'electron-store';
import fs from 'fs/promises';
import path from 'path';
import type { AppSettings } from '../../src/core/settings';
import { mkdirSync, existsSync } from 'fs';

// Manual mock for Electron APIs in a pure Node environment
const mockElectron = {
  app: {
    getPath: (name: string) => {
      // A simplified, hardcoded path for the temp directory
      const tempDir = 'C:/Users/i0swi/AppData/Local/Temp';
      if (!existsSync(tempDir)) {
        mkdirSync(tempDir, { recursive: true });
      }
      return tempDir;
    },
  },
  ipcMain: {
    handle: () => {},
  },
  session: {
    defaultSession: {
      cookies: {
        get: async () => [],
        set: async () => {},
        remove: async () => {},
      },
    },
  },
  BrowserWindow: class MockBrowserWindow {
    loadURL() {}
    webContents = {
      on: () => {},
      removeListener: () => {},
      executeJavaScript: async () => undefined,
      capturePage: async () => ({ toPNG: () => Buffer.from([]) }),
    };
    on() {}
    isDestroyed() { return false; }
    close() {}
  },
};

// Minimal mock helper (placed before use)
const vi = {
  mock: (moduleName: string, factory: () => any) => {
    // Inject into Node's module cache so subsequent imports get the mock
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Module = require('module');
    Module._cache[require.resolve(moduleName)] = { exports: factory() };
  }
};

// Replace the actual electron module with our mock
vi.mock('electron', () => mockElectron);

const getProjectRoot = () => {
  let currentDir = __dirname;
  while (!existsSync(path.join(currentDir, 'package.json'))) {
    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) return process.cwd();
    currentDir = parentDir;
  }
  return currentDir;
};

async function runTest() {
  console.log('Starting standalone YouTube processing test...');

  // Import JobManager after mocking 'electron'
  const { JobManager } = await import('../job-manager');

  const testOutputDir = path.join(mockElectron.app.getPath('temp'), 'job-manager-standalone-test');
  const projectRoot = getProjectRoot();
  const backgroundVideoPath = path.join(projectRoot, 'test-data', 'background.mp4');

  try {
    // 1. Setup environment
    if (existsSync(testOutputDir)) {
      await fs.rm(testOutputDir, { recursive: true, force: true });
    }
    mkdirSync(testOutputDir, { recursive: true });

    if (!existsSync(backgroundVideoPath)) {
      throw new Error(`Background video for test not found at ${backgroundVideoPath}`);
    }

    // 2. Define settings
    const testSettings: AppSettings = {
        general: {
            outputPath: testOutputDir,
            testOutputPath: testOutputDir,
            diagnosticLogging: true,
            diagnosticIntervalSec: 10,
            initialBackfillCount: 1,
        },
        platforms: {
            x: { enabled: false, accounts: [], intervalMinutes: 15, scrapeDelayMs: 100 },
            tiktok: { enabled: false, accounts: [], intervalMinutes: 15, scrapeDelayMs: 100 },
            youtube: {
                enabled: true,
                accounts: [{ id: 'CreativeCommons', isActive: true, backfillRemaining: 1, lastCursor: '', processedIds: [] }],
                intervalMinutes: 1,
                scrapeDelayMs: 100,
            },
        },
        render: {
            resolution: { width: 1080, height: 1920 },
            durationSec: 10,
            bgmPath: '',
            backgroundVideoPath: backgroundVideoPath,
            fontFilePath: '',
            captions: { top: 'YouTube Standalone Test', bottom: 'Creative Commons' },
            scale: 0.9,
            teleTextBg: '#000000',
            qualityPreset: 'standard',
            overlayPosition: 'center',
            topCaptionHeight: 120,
            bottomCaptionHeight: 160,
            captionBgOpacity: 0.8,
            topCaptionPosition: 'center',
            bottomCaptionPosition: 'center',
        },
    };

      // 3. Initialize Store (for settings consumers)
      const store = new Store<AppSettings>({ 
        name: 'test-standalone-store',
        projectName: 'short-video-assistant-standalone-test',
        defaults: testSettings 
      } as any);
      store.store = testSettings;

      // 4. Direct pipeline: list -> download -> generate
      const { listRecentItems } = await import('../tasks/scraper');
      const { downloadVideoToTemp } = await import('../tasks/downloader');
      const { generateVideo } = await import('../tasks/video-generator');

      console.log('Listing recent items...');
      const items = await listRecentItems('youtube', 'CreativeCommons', 1);
      if (!items || items.length === 0) throw new Error('No recent items found.');
      const item = items[0];
      if (item.type !== 'video_url' || !item.url) throw new Error('Expected a video_url item.');

      console.log('Downloading source video...');
      const dl = await downloadVideoToTemp(item.url, 'youtube');
      if (!dl.filepath) throw new Error('Download did not return a file path.');

      console.log('Generating final video...');
      const outPath = await generateVideo('', store.store as AppSettings, dl.filepath);

      const stats = await fs.stat(outPath);
      if (stats.size <= 1000) {
        throw new Error(`The video file seems empty. Size: ${stats.size}`);
      }

      console.log(`SUCCESS: Video file created at ${outPath}`);

  } catch (error) {
    console.error('TEST FAILED:', error);
    process.exit(1);
  } finally {
    // 6. Cleanup
    if (existsSync(testOutputDir)) {
      await fs.rm(testOutputDir, { recursive: true, force: true });
    }
  }
}

runTest();
