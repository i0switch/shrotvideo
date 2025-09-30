import { app, BrowserWindow, ipcMain, IpcMainInvokeEvent } from 'electron';
import path from 'path';
import process from 'node:process';
import { runCapture } from '@core/x/runner';
import { RunnerConfig, RunnerSummary } from '@core/types';
import ElectronStore from 'electron-store';
import { ensureDir } from '@core/utils/paths';

type CaptureStoreSchema = {
  lastRunSummary?: RunnerSummary;
};

declare const __dirname: string;

type ElectronStoreWithSet = ElectronStore<CaptureStoreSchema> & {
  set<Key extends keyof CaptureStoreSchema>(key: Key, value: CaptureStoreSchema[Key]): void;
};

const store = new ElectronStore<CaptureStoreSchema>({ name: 'captureapp' }) as ElectronStoreWithSet;

function createMainWindow() {
  const distRoot = path.resolve(__dirname, '../../..');
  const preloadIndex = path.join(distRoot, 'preload', 'preload', 'index.js');
  const rendererIndex = path.join(distRoot, 'renderer', 'index.html');

  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: preloadIndex,
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    void mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    void mainWindow.loadFile(rendererIndex);
  }
}

app.whenReady().then(() => {
  createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

ipcMain.handle('run-capture', async (_event: IpcMainInvokeEvent, config: RunnerConfig) => {
  ensureDir(config.outDir);
  const summary = await runCapture(config);
  store.set('lastRunSummary', summary);
  return summary;
});
