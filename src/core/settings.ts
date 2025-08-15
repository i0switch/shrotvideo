export type Platform = 'x' | 'tiktok' | 'instagram' | 'youtube';

export interface Account {
  id: string; // or username
  isActive: boolean;
}

export interface PlatformSettings {
  enabled: boolean;
  accounts: Account[];
  intervalMinutes: number;
  scrapeDelayMs: number; // New: Delay before scraping each account in milliseconds
  // Note: Login credentials should be handled securely, not stored here directly
}

export interface AppSettings {
  general: {
    outputPath: string;
  };
  platforms: {
    x: PlatformSettings;
    tiktok: PlatformSettings;
    instagram: PlatformSettings;
    youtube: PlatformSettings;
  };
  render: {
    resolution: {
      width: number;
      height: number;
    };
    durationSec: number;
    bgmPath: string;
    backgroundVideoPath: string;
    captions: {
      top: string;
      bottom: string;
    };
    scale: number;
    teleTextBg: string;
    qualityPreset: 'low' | 'standard' | 'high';
    overlayPosition: 'center' | 'top-center' | 'bottom-center' | 'custom';
    // New properties for caption box
    topCaptionHeight: number; // Height of the top caption background box
    bottomCaptionHeight: number; // Height of the bottom caption background box
    captionBgOpacity: number; // Opacity of the caption background box (0.0 to 1.0)
  };
  // The 'ingest' and 'scheduler' sections are now part of PlatformSettings
}
