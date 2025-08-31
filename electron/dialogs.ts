import * as Electron from 'electron';
import path from 'node:path';
import fs from 'node:fs';

const lastPathFile = path.join(Electron.app.getPath('userData'), 'last-path.json');
type LastPathMap = Record<string, string>;
function loadLastPath(): LastPathMap {
  try {
    const obj = JSON.parse(fs.readFileSync(lastPathFile, 'utf8')) as unknown;
    if (obj && typeof obj === 'object') return obj as LastPathMap;
  } catch {
    // noop
  }
  return {} as LastPathMap;
}
function saveLastPath(obj: LastPathMap) {
  fs.mkdirSync(path.dirname(lastPathFile), { recursive: true });
  fs.writeFileSync(lastPathFile, JSON.stringify(obj));
}

const last: LastPathMap = loadLastPath();

Electron.ipcMain.handle('files.pickFolder', async (e, key: string) => {
  try {
    const wc = e?.sender;
    const win = wc ? Electron.BrowserWindow.fromWebContents(wc) : null;
    console.info('[files] pickFolder open:', { key, hasWin: !!win });
    const opts = {
      title: 'フォルダを選択',
      properties: ['openDirectory','createDirectory'] as const,
      defaultPath: last[key] || undefined,
    };
    let result: { canceled: boolean; filePaths: string[] };
    if (win && !win.isDestroyed()) {
      result = await Electron.dialog.showOpenDialog(win, opts as any) as unknown as { canceled: boolean; filePaths: string[] };
    } else {
      result = await Electron.dialog.showOpenDialog(opts as any) as unknown as { canceled: boolean; filePaths: string[] };
    }
    if (result.canceled) return null;
    last[key] = result.filePaths[0];
    saveLastPath(last);
    console.info('[files] pickFolder selected:', { key, path: result.filePaths[0] });
    return result.filePaths[0];
  } catch (err) {
    console.warn('[files] pickFolder failed:', (err as Error)?.message || String(err));
    return null;
  }
});

Electron.ipcMain.handle('files.pickFile', async (e, key: string, filters?: Electron.FileFilter[]) => {
  try {
    const wc = e?.sender;
    const win = wc ? Electron.BrowserWindow.fromWebContents(wc) : null;
    console.info('[files] pickFile open:', { key, hasWin: !!win, filters });
    const opts = {
      title: 'ファイルを選択',
      properties: ['openFile'] as const,
      filters,
      defaultPath: last[key] || undefined,
    };
    let result: { canceled: boolean; filePaths: string[] };
    if (win && !win.isDestroyed()) {
      result = await Electron.dialog.showOpenDialog(win, opts as any) as unknown as { canceled: boolean; filePaths: string[] };
    } else {
      result = await Electron.dialog.showOpenDialog(opts as any) as unknown as { canceled: boolean; filePaths: string[] };
    }
    if (result.canceled) return null;
    last[key] = result.filePaths[0];
    saveLastPath(last);
    console.info('[files] pickFile selected:', { key, path: result.filePaths[0] });
    return result.filePaths[0];
  } catch (err) {
    console.warn('[files] pickFile failed:', (err as Error)?.message || String(err));
    return null;
  }
});
