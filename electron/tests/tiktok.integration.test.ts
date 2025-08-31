vi.mock('../login', () => ({
  restoreCookies: vi.fn(),
  createLoginWindow: vi.fn(),
  hasSavedCookies: vi.fn(),
}));

import { describe, it, expect, vi } from 'vitest';

// Mock Electron modules for Node.js environment
vi.mock('electron', () => {
  const mockBrowserWindow = vi.fn(() => ({
    loadURL: vi.fn(),
    webContents: {
      removeListener: vi.fn(),
      getURL: vi.fn(),
      on: vi.fn(),
    },
    on: vi.fn(),
    isDestroyed: vi.fn(() => false),
    close: vi.fn(),
  }));
  return {
    app: {
      getPath: vi.fn().mockReturnValue('C:/Users/i0swi/AppData/Local/Temp'),
    },
    ipcMain: {
      handle: vi.fn(),
    },
    session: {
      defaultSession: {
        cookies: {
          get: vi.fn().mockResolvedValue([]),
          set: vi.fn().mockResolvedValue(undefined),
          remove: vi.fn().mockResolvedValue(undefined),
        },
      },
    },
    BrowserWindow: mockBrowserWindow,
  };
});

import { downloadVideoToTemp } from '../tasks/downloader.js';

describe('TikTok Download', () => {
  const TIKTOK_URL = 'https://www.tiktok.com/@scout2015/video/6718335390845095173';

  it('TikTok: resolves a direct media URL (public sample)', async () => {
    const result = await downloadVideoToTemp(TIKTOK_URL, 'tiktok');
    expect(result.filepath).toBeDefined();
    expect(result.filepath).toContain('.mp4');
  }, 180_000);
});
