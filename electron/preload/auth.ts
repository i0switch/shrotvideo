import { contextBridge, ipcRenderer } from 'electron';
// Align with main preload: expose full auth API for all supported platforms
type AuthPlatform = 'x' | 'youtube' | 'tiktok';
contextBridge.exposeInMainWorld('auth', {
  login: (platform: AuthPlatform) => ipcRenderer.invoke('auth.login', platform),
  status: (platform: AuthPlatform) => ipcRenderer.invoke('auth.status', platform) as Promise<boolean>,
  clear: (platform: AuthPlatform) => ipcRenderer.invoke('auth.clear', platform) as Promise<boolean>,
});
