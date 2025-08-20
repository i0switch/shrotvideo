import { contextBridge, ipcRenderer } from 'electron';
contextBridge.exposeInMainWorld('files', {
  pickFolder: (key: string) => ipcRenderer.invoke('files.pickFolder', key),
  pickFile: (key: string, filters?: Electron.FileFilter[]) => ipcRenderer.invoke('files.pickFile', key, filters),
});
