import { contextBridge, ipcRenderer } from 'electron';
import { RunnerConfig, RunnerSummary } from '@core/types';

export interface CaptureApi {
  runCapture(config: RunnerConfig): Promise<RunnerSummary>;
}

const api: CaptureApi = {
  runCapture: (config) => ipcRenderer.invoke('run-capture', config)
};

contextBridge.exposeInMainWorld('captureAPI', api);

declare global {
  interface Window {
    captureAPI?: CaptureApi;
  }
}
