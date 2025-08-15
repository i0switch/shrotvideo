import { describe, it, expect } from 'vitest';

function escapeFFmpegText(text: string): string {
  if (typeof text !== 'string') return '';
  let escaped = '';
  for (const char of text) {
    if (char === '%' || char === '\\' || char === ':' || char === "'") {
      escaped += '\\' + char;
    } else {
      escaped += char;
    }
  }
  return escaped;
}

describe('escapeFFmpegText', () => {
  it('should not change a string with no special characters', () => {
    const text = 'Hello world';
    expect(escapeFFmpegText(text)).toBe('Hello world');
  });

  it('should escape backslashes', () => {
    const text = 'C:\\Users\\Test';
    expect(escapeFFmpegText(text)).toBe('C\\\\Users\\\\Test');
  });

  it('should escape colons', () => {
    const text = 'This is a test: with a colon';
    expect(escapeFFmpegText(text)).toBe('This is a test\\: with a colon');
  });

  it('should escape percentages', () => {
    const text = '100% working';
    expect(escapeFFmpegText(text)).toBe('100\\% working');
  });

  it('should escape single quotes', () => {
    const text = "It's a test";
    expect(escapeFFmpegText(text)).toBe("It\\'s a test");
  });

  it('should handle a combination of special characters', () => {
    const text = "C:\\'s 100% working: yes!";
    expect(escapeFFmpegText(text)).toBe("C\\\\'s 100\\% working\\: yes!");
  });

  it('should handle an empty string', () => {
    const text = '';
    expect(escapeFFmpegText(text)).toBe('');
  });
});