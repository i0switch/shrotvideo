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
  platforms: { x: { enabled: false, accounts: [], intervalMinutes: 15, scrapeDelayMs: 0 }, tiktok: { enabled: false, accounts: [], intervalMinutes: 15, scrapeDelayMs: 0 }, youtube: { enabled: false, accounts: [], intervalMinutes: 15, scrapeDelayMs: 0 } },
    render: {
      resolution: { width: 1080, height: 1920 },
      durationSec: 10,
      bgmPath: '/path/to/bgm.mp3',
      backgroundVideoPath: '/path/to/background.mp4',
      // captions removed in current pipeline
      scale: 0.8,
      qualityPreset: 'standard',
      overlayPosition: 'center',
      // caption related fields removed
    },
  };

  it('should generate a correct ffmpeg command for Function A (screenshot overlay)', async () => {
    await generateVideo('/path/to/screenshot.png', mockSettings);

    // Check inputs
    expect(ffmpeg).toHaveBeenCalled();
    expect(mockFfmpeg.input).toHaveBeenCalledWith('/path/to/background.mp4');
    expect(mockFfmpeg.input).toHaveBeenCalledWith('/path/to/screenshot.png');
    expect(mockFfmpeg.input).toHaveBeenCalledWith('/path/to/bgm.mp3');

  // Check complex filter (current pipeline labels and colors)
  const filterArg = (mockFfmpeg.complexFilter as any).mock.calls[0][0] as string;
  expect(filterArg).toContain('[0:v]scale=1080:1920:force_original_aspect_ratio=increase');
  expect(filterArg).toContain('format=yuv420p[bg]');
  // foreground scaled with numeric dimensions (contain)
  expect(filterArg).toMatch(/\[1:v\]scale=\d+:\d+:force_original_aspect_ratio=decrease\[fg\]/);
  expect(filterArg).toContain('[bg][fg]overlay=(W-w)/2:(H-h)/2[base_with_overlay]');

  // Check output options（出力オプションは個別に呼び出されるケースと配列で渡されるケース双方に対応）
  const outCallsAAll = (mockFfmpeg.outputOptions as any).mock.calls as string[][];
  const outJoined = outCallsAAll.map(args => args.join(' ')).join(' ');
  expect(outJoined).toContain('-t 10');
  expect(outJoined).toContain('-preset veryfast');
  expect(outJoined).toContain('-pix_fmt yuv420p');
  expect(outJoined).toContain('-c:a aac');
  // shortest は使用しない。音声は preferAudioIndex として1:a? or 0:a?が指定される
  expect(outJoined).not.toContain('-shortest');
  expect(outJoined).toContain('-map');

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

  // Check complex filter includes overlay pipeline
  const filterArgB = (mockFfmpeg.complexFilter as any).mock.calls[0][0] as string;
  expect(filterArgB).toContain('[bg][fg]overlay=(W-w)/2:(H-h)/2[src_over_bg]');

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

  it('should prioritize BGM for X platform when available (screenshot overlay case)', async () => {
    vi.clearAllMocks();
    // Use default mockSettings where bgmPath and backgroundVideoPath are set
    await generateVideo('/path/to/screenshot.png', mockSettings, undefined, { accountId: { platform: 'x', id: 'acc' } });

    // Inputs: [0]=bg, [1]=screenshot, [2]=bgm
    expect(mockFfmpeg.input).toHaveBeenCalledWith(mockSettings.render.backgroundVideoPath);
    expect(mockFfmpeg.input).toHaveBeenCalledWith('/path/to/screenshot.png');
    expect(mockFfmpeg.input).toHaveBeenCalledWith('/path/to/bgm.mp3');

    // Should map only one audio stream: bgm -> index 2
    const calls = (mockFfmpeg.outputOptions as any).mock.calls as string[][];
    const joined = calls.map(args => args.join(' ')).join(' ');
    expect(joined).toContain('-map [v_final]');
    expect(joined).toContain('-map 2:a?');
    // and should not additionally map background audio when BGM selected
    expect(joined).not.toContain('-map 0:a? -map 2:a?');
  });
});