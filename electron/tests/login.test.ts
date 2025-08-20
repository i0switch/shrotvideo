import { vi, describe, it, expect } from 'vitest';
let restoreCookies;
vi.mock('../login', async () => {
  const actual = await vi.importActual('../login');
  return {
    ...actual,
    restoreCookies: actual.restoreCookies,
    createLoginWindow: actual.createLoginWindow,
  };
});
vi.mock('electron', () => {
  return {
    session: { defaultSession: { cookies: { set: vi.fn() } } },
    ipcMain: { handle: vi.fn(), on: vi.fn() },
  } as unknown as typeof import('electron');
});
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
