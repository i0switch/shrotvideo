export type Platform = 'x' | 'tiktok' | 'youtube';

export interface Account {
  id: string; // or username
  isActive: boolean;
  // 初回バックフィル残数（ユーザー指定）。0または未設定ならスキップ
  backfillRemaining?: number;
  // 最後に処理したアイテムのカーソル（動画ID/投稿IDなど）。重複処理回避に使用
  lastCursor?: string;
  // 重複ダウンロード/生成を避けるために、既に処理済みのアイテムIDの履歴
  // 最新が配列末尾でも先頭でもよいが、ここでは末尾に追加し最大500件で古い順に削除
  processedIds?: string[];
  // Chroma key specific per-account overrides (optional)
  chromaSimilarity?: number;
  chromaBlend?: number;
  chromaAsset?: string;
}

export interface PlatformSettings {
  enabled: boolean;
  accounts: Account[];
  intervalMinutes: number;
  scrapeDelayMs: number; // New: Delay before scraping each account in milliseconds
  // Note: Login credentials should be handled securely, not stored here directly
  // Optional chroma configuration used by job-manager
  chroma?: {
    enabled?: boolean;
    mode?: 'fixed' | 'random';
    foregroundPath?: string;
    foregroundDir?: string;
  };
}

export interface AppSettings {
  general: {
    outputPath: string;
  testOutputPath?: string;
  // 診断ログ: 詳細状況を一定間隔で出力
  diagnosticLogging?: boolean;
  diagnosticIntervalSec?: number; // 何秒おきに出力するか
  // 初回監視時に遡って保存・加工する件数（YouTube/TikTokの新規アカウントに適用）
  initialBackfillCount?: number;
  // Pipeline options
  autoInjectBgm?: boolean;
  bgmLoudnessNormalize?: boolean;
  chromaDefaultSimilarity?: number;
  chromaDefaultBlend?: number;
  };
  platforms: {
    x: PlatformSettings;
    tiktok: PlatformSettings;
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
  fontFilePath?: string; // drawtext に使用するフォントファイル
    captions: {
      top: string;
      bottom: string;
    };
    scale: number;
    teleTextBg: string;
    // New: caption text color (hex)
    captionTextColor?: string;
    qualityPreset: 'low' | 'standard' | 'high';
    overlayPosition: 'center' | 'top-center' | 'bottom-center' | 'custom';
    // New properties for caption box
    topCaptionHeight: number; // Height of the top caption background box
    bottomCaptionHeight: number; // Height of the bottom caption background box
    captionBgOpacity: number; // Opacity of the caption background box (0.0 to 1.0)
  // New: caption positions (backgrounds follow text position)
  topCaptionPosition?: 'top' | 'center' | 'bottom';
  bottomCaptionPosition?: 'top' | 'center' | 'bottom';
  // New: fine-grained vertical offsets inside caption boxes (px)
  topCaptionOffset?: number;
  bottomCaptionOffset?: number;
  };
  // Optional templates system used to apply per-account/platform presets
  templates?: {
    selection?: string;
    items?: Record<string, Partial<AppSettings>>;
  };
  // The 'ingest' and 'scheduler' sections are now part of PlatformSettings
}
