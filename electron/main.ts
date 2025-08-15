import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import { exec } from 'child_process';
import path from 'path';
// import { fileURLToPath } from 'url';
import Store from 'electron-store';
import type { AppSettings } from '../src/core/settings.js';
import { JobManager } from './job-manager.js';
import log from 'electron-log';
import * as keytar from 'keytar'; // Add this line

// Configure logger
log.initialize();

let mainWindow: BrowserWindow | null = null;


const store = new Store<AppSettings>({
  defaults: {
    general: {
      outputPath: app.getPath('videos'),
    },
    platforms: {
      x: {
        enabled: false,
        accounts: [],
        intervalMinutes: 15,
        scrapeDelayMs: 5000, // New: Default scrape delay of 5 seconds
      },
      tiktok: {
        enabled: false,
        accounts: [],
        intervalMinutes: 15,
        scrapeDelayMs: 5000, // New: Default scrape delay of 5 seconds
      },
      instagram: {
        enabled: false,
        accounts: [],
        intervalMinutes: 15,
        scrapeDelayMs: 5000, // New: Default scrape delay of 5 seconds
      },
      youtube: {
        enabled: false,
        accounts: [],
        intervalMinutes: 15,
        scrapeDelayMs: 5000, // New: Default scrape delay of 5 seconds
      },
    },
    render: {
      resolution: {
        width: 1080,
        height: 1920,
      },
      durationSec: 15,
      bgmPath: '',
      backgroundVideoPath: '',
      captions: {
        top: '',
        bottom: '',
      },
      scale: 0.8,
      teleTextBg: '#000000',
      qualityPreset: 'standard',
      overlayPosition: 'center',
      topCaptionHeight: 120, // Default from GEMINI.md example
      bottomCaptionHeight: 160, // Default from GEMINI.md example
      captionBgOpacity: 1.0, // Default from GEMINI.md example (black@1.0)
    },
  },
});

const jobManager = new JobManager(store);

// Forward logs to renderer
Object.assign(console, log.functions);
log.transports.file.level = 'info';
log.hooks.push((message: any) => {
  if (mainWindow && mainWindow.webContents) {
    mainWindow.webContents.send('log-message', message.data);
  }
  return message; // Added this line
});



async function runShellCommand(command: string): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    exec(command, (error, stdout, stderr) => {
      if (error) {
        reject(error);
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

function setupIpcHandlers() {
  ipcMain.handle('get-settings', () => {
    return (store as any).get();
  });

  ipcMain.handle('set-settings', (event, settings: any) => {
    Object.keys(settings).forEach(key => {
      (store as any).set(key, settings[key]);
    });
  });

  ipcMain.handle('open-directory-dialog', async () => {
    if (!mainWindow) return null;
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory']
    });
    if (Array.isArray(result) && result.length > 0) {
      return result[0];
    }
    return null;
  });

  ipcMain.handle('open-file-dialog', async () => {
    if (!mainWindow) return null;
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
      filters: [
        { name: 'Videos', extensions: ['mp4', 'mov', 'avi'] }
      ]
    });
    if (Array.isArray(result) && result.length > 0) {
      return result[0];
    }
    return null;
  });

  // New: Credential Management Handlers
  ipcMain.handle('set-credential', async (event, service: string, account: string, password: string) => {
    try {
      await keytar.setPassword(service, account, password);
      log.info(`Credential set for service: ${service}, account: ${account}`);
      return true;
    } catch (error) {
      log.error(`Failed to set credential for service: ${service}, account: ${account}`, error);
      return false;
    }
  });

  ipcMain.handle('get-credential', async (event, service: string, account: string) => {
    try {
      const password = await keytar.getPassword(service, account);
      log.info(`Credential retrieved for service: ${service}, account: ${account}`);
      return password;
    } catch (error) {
      log.error(`Failed to get credential for service: ${service}, account: ${account}`, error);
      return null;
    }
  });

  ipcMain.handle('delete-credential', async (event, service: string, account: string) => {
    try {
      const result = await keytar.deletePassword(service, account);
      log.info(`Credential deleted for service: ${service}, account: ${account}. Result: ${result}`);
      return result;
    } catch (error) {
      log.error(`Failed to delete credential for service: ${service}, account: ${account}`, error);
      return false;
    }
  });

  // Job Manager Handlers
  ipcMain.handle('start-monitoring', () => {
    jobManager.start();
  });

  ipcMain.handle('stop-monitoring', () => {
    jobManager.stop();
  });

  ipcMain.handle('get-status', () => {
    return jobManager.getStatus();
  });

  ipcMain.handle('check-and-install-dependencies', async (event, dependency: string) => {
    try {
      log.info(`Checking/Installing dependency: ${dependency}`);
      let stdout = '';
      let stderr = '';

      if (dependency === 'node') {
        ({ stdout, stderr } = await runShellCommand('node -v'));
        log.info(`Node.js version: ${stdout.trim()}`);
        if (!stdout.startsWith('v')) {
          throw new Error('Node.js not found or invalid version.');
        }
      } else if (dependency === 'npm') {
        ({ stdout, stderr } = await runShellCommand('npm -v'));
        log.info(`npm version: ${stdout.trim()}`);
        if (!stdout.match(/^\d+\.\d+\.\d+$/)) { // Basic check for version format
          throw new Error('npm not found or invalid version.');
        }
      } else if (dependency === 'ffmpeg') {
        try {
          ({ stdout, stderr } = await runShellCommand('ffmpeg -version'));
          log.info(`FFmpeg version: ${stdout.split('\n')[0].trim()}`);
        } catch (e) {
          log.warn('FFmpeg not found. Attempting to install...');
          if (process.platform === 'win32') {
            // Windows: Try winget or choco
            try {
              await runShellCommand('winget install --id Gyan.FFmpeg');
              log.info('FFmpeg installed via winget.');
            } catch (wingetError: any) {
              log.warn(`winget install failed: ${wingetError.message}, trying choco...`);
              await runShellCommand('choco install ffmpeg -y');
              log.info('FFmpeg installed via choco.');
            }
          } else if (process.platform === 'darwin') {
            // macOS: brew
            await runShellCommand('brew install ffmpeg');
            log.info('FFmpeg installed via brew.');
          } else {
            throw new Error('Unsupported OS for automatic FFmpeg installation.');
          }
          // Verify installation
          ({ stdout, stderr } = await runShellCommand('ffmpeg -version'));
          log.info(`FFmpeg version after install: ${stdout.split('\n')[0].trim()}`);
        }
      } else {
        throw new Error(`Unknown dependency: ${dependency}`);
      }
      return { success: true, message: stdout.trim() };
    } catch (error: any) {
      log.error(`Failed to check/install ${dependency}:`, error.message);
      return { success: false, message: error.message || 'Unknown error' };
    }
  });
}

const createWindow = () => {
  // Create the browser window.
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  // and load the index.html of the app.
  // Vite DEV server URL
  const devServerURL = 'http://localhost:8080';
  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL(devServerURL);
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  // Open the DevTools.
  if (process.env.NODE_ENV === 'development') {
    mainWindow.webContents.openDevTools();
  }
};

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.on('ready', () => {
  createWindow();
  setupIpcHandlers();
});

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and import them here.
