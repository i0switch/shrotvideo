import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let win;
function create() {
  win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
  preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.webContents.openDevTools({ mode: 'detach' });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

app.whenReady().then(create);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) create(); });

ipcMain.handle('pickFile', async (_e, filters) => {
  const { canceled, filePaths } = await dialog.showOpenDialog(win, { properties: ['openFile'], filters });
  return canceled ? null : filePaths[0];
});

ipcMain.handle('runFFmpeg', async (_e, args) => new Promise((resolve) => {
  const child = spawn('ffmpeg', args, { windowsHide: true });
  let stderr = '';
  child.stderr.on('data', (d) => { stderr += d.toString(); });
  child.on('close', (code) => resolve({ code, stderr }));
}));
