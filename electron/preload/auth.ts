import { contextBridge, ipcRenderer } from 'electron';
// Note: The main preload exposes full auth API; keep this as a minimal shim if imported elsewhere.
contextBridge.exposeInMainWorld('auth', {
  login: (platform: 'x') => ipcRenderer.invoke('auth.login', platform),
});
