// Minimal shims so tsc can compile Electron code without @types/electron
// We rely on runtime Electron modules; this only silences type errors.
declare module 'electron' {
  export const app: any;
  export class BrowserWindow {
    constructor(...args: any[]);
    static fromWebContents: (...args: any[]) => any;
    static getAllWindows: () => any[];
    [key: string]: any;
  }
  export const ipcMain: any;
  export const session: any;
  export const contextBridge: any;
  export const ipcRenderer: any;
  export const dialog: any;
  export const globalShortcut: any;
  // types
  export type Cookie = any;
  export type FileFilter = any;
  export type IpcRendererEvent = any;
}

declare namespace Electron {
  type Cookie = any;
  type Event = any;
  type IpcRendererEvent = any;
  type FileFilter = any;
  type Rectangle = any;
}
