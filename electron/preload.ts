import { contextBridge, ipcRenderer } from 'electron';
import type { AppSettings } from '../src/core/settings.js'; // Adjust path if necessary

const electronAPI = {
  getSettings: () => ipcRenderer.invoke('get-settings'),
  setSettings: (settings: AppSettings) => ipcRenderer.invoke('set-settings', settings),
  openDirectoryDialog: () => ipcRenderer.invoke('open-directory-dialog'),
  openFileDialog: () => ipcRenderer.invoke('open-file-dialog'),
  startMonitoring: () => ipcRenderer.invoke('start-monitoring'),
  stopMonitoring: () => ipcRenderer.invoke('stop-monitoring'),
  // 旧 'get-status' は詳細オブジェクトを返すため、フロント型に合わせた簡易エイリアスを使用
  getStatus: () => ipcRenderer.invoke('get-status-simple'),
  onLogMessage: (callback: (message: string) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, message: unknown) => {
      callback(String(message));
    };
    ipcRenderer.on('log-message', handler);
    // Return a cleanup function
    return () => {
      ipcRenderer.removeListener('log-message', handler);
    };
  },
  // New: Credential Management
  setCredential: (service: string, account: string, password: string) => ipcRenderer.invoke('set-credential', service, account, password),
  getCredential: (service: string, account: string) => ipcRenderer.invoke('get-credential', service, account),
  deleteCredential: (service: string, account: string) => ipcRenderer.invoke('delete-credential', service, account),
  checkAndInstallDependencies: (dependency: string) => ipcRenderer.invoke('check-and-install-dependencies', dependency),
  // Render test generate
  testGenerate: (filePath: string) => ipcRenderer.invoke('render.testGenerate', filePath) as Promise<string>,
  previewGenerate: (filePath: string) => ipcRenderer.invoke('render.previewGenerate', filePath) as Promise<string>,
  // Immediate backfill trigger
  startInitialFetch: (platform: 'x'|'tiktok'|'instagram'|'youtube', accountId: string) => ipcRenderer.invoke('jobs.startInitialFetch', platform, accountId) as Promise<boolean>,
  testProcessAllOnce: () => ipcRenderer.invoke('jobs.testProcessAllOnce') as Promise<{ ok: boolean; summary?: { totalAccounts: number; attempted: number; processed: number; }; error?: string }>,
};

// auth API (X のみ対応)
const authAPI = {
  login: (platform: 'x') => ipcRenderer.invoke('auth.login', platform),
  status: (platform: 'x') => ipcRenderer.invoke('auth.status', platform) as Promise<boolean>,
  clear: (platform: 'x') => ipcRenderer.invoke('auth.clear', platform) as Promise<boolean>,
};

// files API
const filesAPI = {
  pickFolder: (key: string) => ipcRenderer.invoke('files.pickFolder', key),
  pickFile: (key: string, filters?: Electron.FileFilter[]) => ipcRenderer.invoke('files.pickFile', key, filters),
};

// logs API
const logsAPI = {
  file: () => ipcRenderer.invoke('logs.file') as Promise<string>,
  read: (maxBytes?: number) => ipcRenderer.invoke('logs.read', maxBytes) as Promise<string>,
  jsonlFile: () => ipcRenderer.invoke('logs.jsonlFile') as Promise<string>,
  readJsonl: (maxBytes?: number) => ipcRenderer.invoke('logs.readJsonl', maxBytes) as Promise<string>,
};

contextBridge.exposeInMainWorld('electronAPI', electronAPI);
contextBridge.exposeInMainWorld('auth', authAPI);
contextBridge.exposeInMainWorld('files', filesAPI);
contextBridge.exposeInMainWorld('logs', logsAPI);
// Forward renderer console errors to main log via IPC (best-effort)
window.addEventListener('error', (ev) => {
  try { ipcRenderer.send('log-message', `[renderer:error] ${ev.message}`); } catch { /* swallow */ }
});
window.addEventListener('unhandledrejection', (ev: PromiseRejectionEvent) => {
  try { ipcRenderer.send('log-message', `[renderer:unhandledrejection] ${String(ev.reason)}`); } catch { /* swallow */ }
});
console.info('[preload] APIs exposed: electronAPI, auth, files, logs');
