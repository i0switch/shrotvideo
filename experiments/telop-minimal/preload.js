import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('api', {
  pickVideo: () => ipcRenderer.invoke('pickFile', [{ name: 'Video', extensions: ['mp4','mov','mkv','webm','avi'] }]),
  pickAudio: () => ipcRenderer.invoke('pickFile', [{ name: 'Audio', extensions: ['mp3','wav','aac','m4a','flac'] }]),
  pickFont: () => ipcRenderer.invoke('pickFile', [{ name: 'Font', extensions: ['ttf','otf','ttc'] }]),
  runFFmpeg: (args) => ipcRenderer.invoke('runFFmpeg', args),
});
