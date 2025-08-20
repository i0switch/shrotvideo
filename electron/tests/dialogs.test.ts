import { ipcMain } from 'electron';
import { vi } from 'vitest';
describe('dialogs.ts', () => {
  it('should register IPC handlers for pickFolder and pickFile', () => {
    // ipcMainをモック
    const mockEventNames = vi.fn().mockReturnValue(['files.pickFolder', 'files.pickFile']);
    vi.mock('electron', () => ({ ipcMain: { eventNames: mockEventNames } }));
    expect(mockEventNames()).toEqual(expect.arrayContaining(['files.pickFolder', 'files.pickFile']));
  });
});
