import { contextBridge, ipcRenderer } from 'electron';
import type { AppSettings } from '#common/settings.js'; // Adjust path if necessary

const electronAPI = {
  getSettings: () => ipcRenderer.invoke('get-settings'),
  setSettings: (settings: AppSettings) => ipcRenderer.invoke('set-settings', settings),
  openDirectoryDialog: () => ipcRenderer.invoke('open-directory-dialog'),
  openFileDialog: () => ipcRenderer.invoke('open-file-dialog'),
  startMonitoring: () => ipcRenderer.invoke('start-monitoring'),
  stopMonitoring: () => ipcRenderer.invoke('stop-monitoring'),
  getStatus: () => ipcRenderer.invoke('get-status'),
  onLogMessage: (callback: (message: string) => void) => {
    const handler = (event: any, message: any) => callback(message);
    ipcRenderer.on('log-message', handler);
    // Return a cleanup function
    return () => {
      ipcRenderer.removeListener('log-message', handler);
    };
  },
  // New: Browser-based Authentication
  loginWithBrowser: (platform: string) => ipcRenderer.invoke('login-with-browser', platform),
  logout: (platform: string) => ipcRenderer.invoke('logout', platform),
  checkLoginStatus: (platform: string) => ipcRenderer.invoke('check-login-status', platform),

  checkAndInstallDependencies: (dependency: string) => ipcRenderer.invoke('check-and-install-dependencies', dependency),
};

contextBridge.exposeInMainWorld('electronAPI', electronAPI);
