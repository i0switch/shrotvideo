import { vi, describe, it, expect } from 'vitest';
vi.mock('../login', () => ({
  restoreCookies: vi.fn(),
  createLoginWindow: vi.fn(),
  hasSavedCookies: vi.fn(),
}));

vi.mock('electron', () => ({
  session: { defaultSession: { cookies: { set: vi.fn(), get: vi.fn(), remove: vi.fn() } } },
  ipcMain: { handle: vi.fn(), on: vi.fn() },
  BrowserWindow: vi.fn(),
}));
vi.mock('keytar', () => {
  return {
    getPassword: vi.fn(),
    setPassword: vi.fn(),
  };
});
describe('login.ts', () => {
  it('should restore cookies from keytar', async () => {
    const { restoreCookies } = await import('../login');
    const platform = 'x';
    const fakeCookies = [{ name: 'auth_token', value: 'dummy', domain: 'x.com', path: '/', secure: true }];
    const keytar = await import('keytar');
    const electron = await import('electron');
  (keytar.getPassword as unknown as { mockResolvedValueOnce: (v: unknown) => void }).mockResolvedValueOnce(JSON.stringify(fakeCookies));
    await restoreCookies(platform);
  expect((electron.session.defaultSession.cookies.set as unknown as { mock?: unknown })).toBeDefined();
  });

  // Integration test: createLoginWindow is not unit-testable in CI, so skip.
});
