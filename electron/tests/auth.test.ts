import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as keytar from 'keytar';
import { chromium } from 'playwright';
import { loginWithBrowser, logout, checkLoginStatus, getCookies } from '../auth';

// Mock dependencies
vi.mock('keytar', () => ({
  setPassword: vi.fn(),
  getPassword: vi.fn(),
  deletePassword: vi.fn(),
}));
vi.mock('playwright', () => ({
  chromium: {
    launch: vi.fn(),
  },
}));

describe('Authentication Logic', () => {
  let mockPage: any;
  let mockContext: any;
  let mockBrowser: any;

  beforeEach(() => {
    // Reset mocks before each test
    vi.resetAllMocks();

    // Setup mock Playwright objects
    mockPage = {
      goto: vi.fn().mockResolvedValue(null),
      waitForURL: vi.fn().mockResolvedValue(null),
    };
    mockContext = {
      newPage: vi.fn().mockResolvedValue(mockPage),
      cookies: vi.fn().mockResolvedValue([{ name: 'session', value: 'mock_session_id' }]),
    };
    mockBrowser = {
      newContext: vi.fn().mockResolvedValue(mockContext),
      close: vi.fn().mockResolvedValue(null),
    };
    (chromium.launch as vi.Mock).mockResolvedValue(mockBrowser);
  });

  describe('loginWithBrowser', () => {
    it('should launch playwright and navigate to the correct login page for X', async () => {
      await loginWithBrowser('x');
      expect(chromium.launch).toHaveBeenCalledWith({ headless: false });
      expect(mockPage.goto).toHaveBeenCalledWith('https://x.com/login');
    });

    it('should wait for home URL and save cookies on successful login', async () => {
      await loginWithBrowser('x');
      expect(mockPage.waitForURL).toHaveBeenCalledWith('**https://x.com/home**', { timeout: 300000 });
      expect(mockContext.cookies).toHaveBeenCalled();
      expect(keytar.setPassword).toHaveBeenCalledWith(
        'com.gemini.shortvideotool.x',
        'x-session',
        JSON.stringify([{ name: 'session', value: 'mock_session_id' }])
      );
      expect(mockBrowser.close).toHaveBeenCalled();
    });

    it('should return false if waiting for URL times out', async () => {
      mockPage.waitForURL.mockRejectedValue(new Error('Timeout'));
      const result = await loginWithBrowser('x');
      expect(result).toBe(false);
      expect(keytar.setPassword).not.toHaveBeenCalled();
      expect(mockBrowser.close).toHaveBeenCalled();
    });
  });

  describe('logout', () => {
    it('should call keytar.deletePassword for the correct platform', async () => {
      await logout('tiktok');
      expect(keytar.deletePassword).toHaveBeenCalledWith(
        'com.gemini.shortvideotool.tiktok',
        'tiktok-session'
      );
    });
  });

  describe('checkLoginStatus', () => {
    it('should return true if cookies exist in keytar', async () => {
      (keytar.getPassword as vi.Mock).mockResolvedValue('[{ "name": "session" }]');
      const status = await checkLoginStatus('instagram');
      expect(keytar.getPassword).toHaveBeenCalledWith(
        'com.gemini.shortvideotool.instagram',
        'instagram-session'
      );
      expect(status).toBe(true);
    });

    it('should return false if no cookies are found in keytar', async () => {
      (keytar.getPassword as vi.Mock).mockResolvedValue(null);
      const status = await checkLoginStatus('youtube');
      expect(status).toBe(false);
    });
  });

  describe('getCookies', () => {
    it('should call keytar.getPassword with the correct service and account', async () => {
      await getCookies('x');
      expect(keytar.getPassword).toHaveBeenCalledWith(
        'com.gemini.shortvideotool.x',
        'x-session'
      );
    });
  });
});
