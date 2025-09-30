export type Platform = 'x' | 'tiktok' | 'youtube';

export interface Account {
  id: string; // or username
  isActive: boolean;
  // アカウント単位のクロマキー合成モード
  // none: 何もしない, image: 画像(kuroma.png)をクロマキーで重ねる, video: 動画(kuroma.mp4)をクロマキーで重ねる
  chromaMode?: 'none' | 'image' | 'video';
  // アカウント単位のクロマキー素材パス（任意）。未指定時はクロマキー合成を行いません。
  chromaImagePath?: string; // 例: C:/path/to/kuroma.png
  chromaVideoPath?: string; // 例: C:/path/to/kuroma.mp4
  // 初回バックフィル残数（ユーザー指定）。0または未設定ならスキップ
  backfillRemaining?: number;
  // 最後に処理したアイテムのカーソル（動画ID/投稿IDなど）。重複処理回避に使用
  lastCursor?: string;
  // 重複ダウンロード/生成を避けるために、既に処理済みのアイテムIDの履歴
  // 最新が配列末尾でも先頭でもよいが、ここでは末尾に追加し最大500件で古い順に削除
  processedIds?: string[];
}

export interface PlatformSettings {
  enabled: boolean;
  accounts: Account[];
  intervalMinutes: number;
  scrapeDelayMs: number; // New: Delay before scraping each account in milliseconds
  // Note: Login credentials should be handled securely, not stored here directly
}

// フォルダ監視設定
export interface WatchedFolder {
  // 一意キーとしてパスを利用（重複回避のためUIでは同一パスの重複を抑止する想定）
  path: string;
  isActive: boolean;
  // フォルダごとの監視間隔（分）
  intervalMinutes: number;
  // サブフォルダも対象にする
  includeSubfolders?: boolean;
  // フォルダ単位のクロマキー合成モード
  chromaMode?: 'none' | 'image' | 'video';
  chromaImagePath?: string;
  chromaVideoPath?: string;
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
    // ローカルフォルダ監視の設定一覧
    watchedFolders?: WatchedFolder[];
    // フォルダ監視: 処理済みキャッシュ保持時間（時間）
    watchedFoldersRetentionHours?: number;
    // フォルダ監視: 処理済みキャッシュの最大保存件数（フォルダごと）
    watchedFoldersMaxCache?: number;
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
    scale: number;
    qualityPreset: 'low' | 'standard' | 'high';
    overlayPosition: 'center' | 'top-center' | 'bottom-center' | 'custom';
    // 以降はテロップ撤去により不要
  };
  // The 'ingest' and 'scheduler' sections are now part of PlatformSettings
}
