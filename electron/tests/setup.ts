import { vi } from 'vitest';

// Mock window.electronAPI
// You'll need to mock the specific methods that your components/hooks use
// For example, if useSettings uses window.electronAPI.getSettings()
Object.defineProperty(window, 'electronAPI', {
  value: {
    getSettings: vi.fn(() => Promise.resolve({})), // Return a default empty settings object
    setSettings: vi.fn(() => Promise.resolve()),
    openDirectoryDialog: vi.fn(() => Promise.resolve(null)),
    openFileDialog: vi.fn(() => Promise.resolve(null)),
    startMonitoring: vi.fn(() => Promise.resolve()),
    stopMonitoring: vi.fn(() => Promise.resolve()),
    getStatus: vi.fn(() => Promise.resolve({ isRunning: false, queueSize: 0, platforms: {} })),
    onLogMessage: vi.fn(() => () => {}), // Return an unsubscribe function
    setCredential: vi.fn(() => Promise.resolve(true)),
    getCredential: vi.fn(() => Promise.resolve(null)),
    deleteCredential: vi.fn(() => Promise.resolve(true)),
  },
  writable: true,
  configurable: true,
});

// Mock app.getPath for Electron main process tests if needed
// This might be more relevant for Node.js environment tests (e.g., job-manager.test.ts)
// if you decide to run them with Vitest as well.
// For now, we'll keep it simple.
