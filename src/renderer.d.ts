export interface JobStatus {
  isRunning: boolean;
  queueSize: number;
  pendingTasks: number;
}

import type { AppSettings } from '@/core/settings';

export interface IElectronAPI {
  getSettings: () => Promise<AppSettings>;
  setSettings: (settings: AppSettings) => Promise<void>;
  openDirectoryDialog: () => Promise<string | null>;
  openFileDialog: () => Promise<string | null>;
  startMonitoring: () => Promise<void>;
  stopMonitoring: () => Promise<void>;
  getStatus: () => Promise<JobStatus>;
  onLogMessage: (callback: (message: string) => void) => () => void;
  // Credential helpers (optional)
  setCredential: (service: string, account: string, password: string) => Promise<boolean>;
  getCredential: (service: string, account: string) => Promise<string | null>;
  deleteCredential: (service: string, account: string) => Promise<boolean>;
  testGenerate: (filePath: string) => Promise<string>;
  previewGenerate: (filePath: string) => Promise<string>;
  // Trigger immediate initial fetch/backfill for a newly added account
  startInitialFetch: (platform: 'x'|'tiktok'|'instagram'|'youtube', accountId: string) => Promise<boolean>;
  testProcessAllOnce: () => Promise<{ ok: boolean; summary?: { totalAccounts: number; attempted: number; processed: number; }; error?: string }>;
}

export interface IAuthAPI {
  login: (platform: 'x') => Promise<void>;
  status: (platform: 'x') => Promise<boolean>;
  clear: (platform: 'x') => Promise<boolean>;
}

export type FileFilter = { name: string; extensions: string[] };
export interface IFilesAPI {
  pickFolder: (key: string) => Promise<string | null>;
  pickFile: (key: string, filters?: FileFilter[]) => Promise<string | null>;
}

export interface ILogsAPI {
  file: () => Promise<string>;
  read: (maxBytes?: number) => Promise<string>;
  jsonlFile: () => Promise<string>;
  readJsonl: (maxBytes?: number) => Promise<string>;
}

declare global {
  interface Window {
    electronAPI: IElectronAPI;
    auth: IAuthAPI;
    files: IFilesAPI;
  logs: ILogsAPI;
  }
}
