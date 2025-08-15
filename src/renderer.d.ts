export interface JobStatus {
  isRunning: boolean;
  queueSize: number;
  pendingTasks: number;
}

export interface IElectronAPI {
  getSettings: () => Promise<any>;
  setSettings: (settings: any) => Promise<void>;
  openDirectoryDialog: () => Promise<string | null>;
  openFileDialog: () => Promise<string | null>;
  startMonitoring: () => Promise<void>;
  stopMonitoring: () => Promise<void>;
  getStatus: () => Promise<JobStatus>;
  onLogMessage: (callback: (message: string) => void) => void;
}

declare global {
  interface Window {
    electronAPI: IElectronAPI
  }
}
