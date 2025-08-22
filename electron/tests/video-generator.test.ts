import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generateVideo } from '../tasks/video-generator.js';
import type { AppSettings } from '../../src/core/settings';
import ffmpeg from 'fluent-ffmpeg';

// Mock fluent-ffmpeg
const mockFfmpeg = {
  input: vi.fn().mockReturnThis(),
  complexFilter: vi.fn().mockReturnThis(),
  outputOptions: vi.fn().mockReturnThis(),
  duration: vi.fn().mockReturnThis(),
  videoCodec: vi.fn().mockReturnThis(),
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
  platforms: { x: { enabled: false, accounts: [], intervalMinutes: 15, scrapeDelayMs: 0 }, tiktok: { enabled: false, accounts: [], intervalMinutes: 15, scrapeDelayMs: 0 }, instagram: { enabled: false, accounts: [], intervalMinutes: 15, scrapeDelayMs: 0 }, youtube: { enabled: false, accounts: [], intervalMinutes: 15, scrapeDelayMs: 0 } },
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

    // Check complex filter (updated: overlay fg uses min(iw*scale, W/H) with aspect ratio)
    expect(mockFfmpeg.complexFilter).toHaveBeenCalledWith(
      expect.stringContaining("[1:v]scale=w='min(iw*0.8,1080)':h='min(ih*0.8,1920)':force_original_aspect_ratio=decrease[fg]") &&
      expect.stringContaining('[0:v]scale=1080:1920,format=yuv420p[bg]') &&
      expect.stringContaining('[bg][fg]overlay=(W-w)/2:(H-h)/2[base_with_overlay]') &&
      expect.stringContaining('[base_with_overlay]drawbox=x=0:y=0:w=iw:h=120:color=#000000@1:t=fill[v_with_top_box]') &&
      expect.stringContaining("drawtext=text='TOP TEXT'") &&
      expect.stringContaining("drawtext=text='BOTTOM TEXT'") &&
      expect.stringContaining('fontsize=48') && // Top font size for 1920px height
      expect.stringContaining('fontsize=42') // Bottom font size for 1920px height
    );

  // Check output options
  expect(mockFfmpeg.outputOptions).toHaveBeenCalledWith(expect.arrayContaining(['-t', '10']));
  expect(mockFfmpeg.outputOptions).toHaveBeenCalledWith(expect.arrayContaining(['-preset', 'veryfast']));
  expect(mockFfmpeg.outputOptions).toHaveBeenCalledWith(expect.arrayContaining(['-pix_fmt', 'yuv420p']));
  expect(mockFfmpeg.outputOptions).toHaveBeenCalledWith(expect.arrayContaining(['-c:a', 'aac']));
  expect(mockFfmpeg.outputOptions).toHaveBeenCalledWith(expect.arrayContaining(['-shortest']));
  expect(mockFfmpeg.outputOptions).toHaveBeenCalledWith(expect.arrayContaining(['-map', '0:a?']));
  expect(mockFfmpeg.outputOptions).toHaveBeenCalledWith(expect.arrayContaining(['-map', '2:a?'])); // Assuming bgmInputIndex is 2 in this test case

    // Check save was called
    expect(mockFfmpeg.save).toHaveBeenCalledWith(expect.stringMatching(/\/tmp\/videos\/video-\d+\.mp4/));
  });

  it('should generate a correct ffmpeg command for Function B (video re-encode)', async () => {
    const sourceUrl = 'http://example.com/source.mp4';
    await generateVideo('', mockSettings, sourceUrl);

    // Check inputs
    expect(mockFfmpeg.input).toHaveBeenCalledWith(sourceUrl);
    expect(mockFfmpeg.input).toHaveBeenCalledWith(mockSettings.render.backgroundVideoPath);
    expect(mockFfmpeg.input).not.toHaveBeenCalledWith('/path/to/screenshot.png');

    // Check complex filter to ensure it uses the overlay pipeline now
    expect(mockFfmpeg.complexFilter).toHaveBeenCalledWith(
      expect.stringContaining('[bg][fg]overlay=(W-w)/2:(H-h)/2[base_with_overlay]')
    );

  // Should NOT force duration (-t) for source videos by default
  const calls = mockFfmpeg.outputOptions.mock.calls as string[][];
  const joined = calls.map(args => args.join(' ')).join(' ');
  expect(joined).not.toContain('-t ');
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