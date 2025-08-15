import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generateVideo } from '../tasks/video-generator.js';
import type { AppSettings } from '../../src/core/settings';
import ffmpeg from 'fluent-ffmpeg';

// Mock fluent-ffmpeg
const mockFfmpeg = {
  input: vi.fn().mockReturnThis(),
  complexFilter: vi.fn().mockReturnThis(),
  outputOptions: vi.fn().mockReturnThis(),
  on: vi.fn((event, callback) => {
    if (event === 'end') {
      // Immediately call the 'end' callback to resolve the promise
      callback();
    }
    return mockFfmpeg; // Return this for chaining
  }),
  save: vi.fn().mockReturnThis(),
  // Add a start event mock for logging
  onStart: vi.fn().mockReturnThis(),
};

vi.mock('fluent-ffmpeg', () => ({
  default: vi.fn(() => mockFfmpeg),
}));
vi.mock('electron-log', () => ({
    default: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
    }
}));


describe('generateVideo', () => {
  // Reset mocks before each test
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset the mock implementation for 'on' to its default testing behavior
    mockFfmpeg.on.mockImplementation((event, callback) => {
        if (event === 'end') {
            callback();
        }
        return mockFfmpeg;
    });
  });

  const mockSettings: AppSettings = {
    general: {
      outputPath: '/tmp/videos',
    },
    platforms: { /* ... not needed for this test ... */ } as any,
    render: {
      resolution: { width: 1080, height: 1920 },
      durationSec: 10,
      bgmPath: '/path/to/bgm.mp3',
      backgroundVideoPath: '/path/to/background.mp4',
      captions: { top: "TOP TEXT", bottom: "BOTTOM TEXT" },
      scale: 0.8,
      teleTextBg: '#000000',
      qualityPreset: 'standard',
      overlayPosition: 'center',
      topCaptionHeight: 120,
      bottomCaptionHeight: 160,
      captionBgOpacity: 1.0,
    },
  };

  it('should generate a correct ffmpeg command for Function A (screenshot overlay)', async () => {
    await generateVideo('/path/to/screenshot.png', mockSettings);

    // Check inputs
    expect(ffmpeg).toHaveBeenCalled();
    expect(mockFfmpeg.input).toHaveBeenCalledWith('/path/to/background.mp4');
    expect(mockFfmpeg.input).toHaveBeenCalledWith('/path/to/screenshot.png');
    expect(mockFfmpeg.input).toHaveBeenCalledWith('/path/to/bgm.mp3');

    // Check complex filter
    expect(mockFfmpeg.complexFilter).toHaveBeenCalledWith(
      expect.stringContaining('[1:v]scale=iw*0.8:-1[fg]') &&
      expect.stringContaining('[0:v]scale=1080:1920,format=yuv420p[bg]') &&
      expect.stringContaining('[bg][fg]overlay=(W-w)/2:(H-h)/2[base_with_overlay]') &&
      expect.stringContaining('[base_with_overlay]drawbox=x=0:y=0:w=iw:h=120:color=#000000@1:t=fill[v_with_top_box]') &&
      expect.stringContaining("drawtext=text='TOP TEXT'") &&
      expect.stringContaining("drawtext=text='BOTTOM TEXT'") &&
      expect.stringContaining('fontsize=48') && // Top font size for 1920px height
      expect.stringContaining('fontsize=42') // Bottom font size for 1920px height
    );

    // Check output options
    expect(mockFfmpeg.outputOptions).toHaveBeenCalledWith(expect.arrayContaining(['-t 10']));
    expect(mockFfmpeg.outputOptions).toHaveBeenCalledWith(expect.arrayContaining(['-preset veryfast']));
    expect(mockFfmpeg.outputOptions).toHaveBeenCalledWith(expect.arrayContaining(['-shortest']));

    // Check save was called
    expect(mockFfmpeg.save).toHaveBeenCalledWith(expect.stringMatching(/\/tmp\/videos\/video-\d+\.mp4/));
  });

  it('should generate a correct ffmpeg command for Function B (video re-encode)', async () => {
    const sourceUrl = 'http://example.com/source.mp4';
    await generateVideo('', mockSettings, sourceUrl);

    // Check inputs
    expect(mockFfmpeg.input).toHaveBeenCalledWith(sourceUrl);
    expect(mockFfmpeg.input).not.toHaveBeenCalledWith('/path/to/screenshot.png');

    // Check complex filter
    expect(mockFfmpeg.complexFilter).toHaveBeenCalledWith(
        expect.stringContaining(`[0:v]scale=1080:1920,format=yuv420p[base_with_overlay]`) &&
        expect.not.stringContaining('[bg][fg]overlay') // Should not contain overlay logic
    );
  });

  it('should reject if ffmpeg encounters an error', async () => {
    const errorMessage = 'ffmpeg error';
    // Override the mock for this specific test
    mockFfmpeg.on.mockImplementation((event, callback) => {
        if (event === 'error') {
            callback(new Error(errorMessage), '', 'stderr output');
        }
        return mockFfmpeg;
    });

    await expect(generateVideo('/path/to/screenshot.png', mockSettings)).rejects.toThrow(errorMessage);
  });

  it('should reject if no background video is provided for Function A', async () => {
    const settingsWithoutBg = {
        ...mockSettings,
        render: {
            ...mockSettings.render,
            backgroundVideoPath: '',
        }
    };
    await expect(generateVideo('/path/to/screenshot.png', settingsWithoutBg)).rejects.toThrow('A background or source video must be provided.');
  });
});