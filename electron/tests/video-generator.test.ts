import { describe, it, expect } from 'vitest'; // Import from vitest for clarity
import { escapeFFmpegText, getOverlayPosition, getFontSize } from '../tasks/video-generator.js'; 

describe('video-generator utility functions', () => {
  describe('escapeFFmpegText', () => {
    it('should escape single quotes', () => {
      expect(escapeFFmpegText("It's a test")).to.equal("It's a test");
    });

    it('should escape backslashes', () => {
      expect(escapeFFmpegText("C:\\path\\to\\file")).to.equal("C:\\path\\to\\file"); // Corrected expectation
    });

    it('should escape colons', () => {
      expect(escapeFFmpegText("time:00:00")).to.equal("time\:00\:00");
    });

    it('should escape percent signs', () => {
      expect(escapeFFmpegText("100% complete")).to.equal("100\% complete");
    });

    it('should handle empty string', () => {
      expect(escapeFFmpegText("")).to.equal("");
    });

    it('should handle string with no special characters', () => {
      expect(escapeFFmpegText("Hello World")).to.equal("Hello World");
    });

    it('should handle mixed special characters', () => {
      expect(escapeFFmpegText("It's 100% done: C:\test")).to.equal("It's 100\% done\: C:\\test");
    });
  });

  describe('getOverlayPosition', () => {
    it('should return center position for "center"', () => {
      expect(getOverlayPosition('center', 1920, 1080, 0.8)).to.equal('(W-w)/2:(H-h)/2');
    });

    it('should return top-center position for "top-center"', () => {
      expect(getOverlayPosition('top-center', 1920, 1080, 0.8)).to.equal('(W-w)/2:0');
    });

    it('should return bottom-center position for "bottom-center"', () => {
      expect(getOverlayPosition('bottom-center', 1920, 1080, 0.8)).to.equal('(W-w)/2:H-h');
    });

    it('should return center for "custom" (default fallback)', () => {
      expect(getOverlayPosition('custom', 1920, 1080, 0.8)).to.equal('(W-w)/2:(H-h)/2');
    });
  });

  describe('getFontSize', () => {
    it('should return 48 for video height >= 1920', () => {
      expect(getFontSize(1920)).to.equal(48);
      expect(getFontSize(2000)).to.equal(48);
    });

    it('should return 36 for video height >= 1080 and < 1920', () => {
      expect(getFontSize(1080)).to.equal(36);
      expect(getFontSize(1500)).to.equal(36);
      expect(getFontSize(1919)).to.equal(36);
    });

    it('should return 24 for video height < 1080', () => {
      expect(getFontSize(1079)).to.equal(24);
      expect(getFontSize(720)).to.equal(24);
      expect(getFontSize(480)).to.equal(24);
    });
  });
});