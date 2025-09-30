export type PostKind = 'single_video' | 'multi_video' | 'image' | 'text';

export interface RunnerConfig {
  handle: string;
  count: number;
  selector: string;
  outDir: string;
  headless: boolean;
  parallel: number;
  browserChannel: 'chrome' | 'chromium';
  storageStatePath: string;
}

export interface PostTarget {
  url: string;
  tweetId: string;
}

export interface MediaBoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ClassificationResult {
  kind: PostKind;
  hasVideo: boolean;
  hasMultipleVideos: boolean;
  hasImage: boolean;
}

export interface PostProcessResult {
  target: PostTarget;
  outputDir: string;
  screenshotPath: string;
  videoPath?: string;
  compositedPath?: string;
  metaPath: string;
  classification: ClassificationResult;
  boundingBox?: MediaBoundingBox;
  attempts: number;
  status: 'success' | 'partial' | 'failed';
  errors: string[];
  downloadSource?: string;
}

export interface RunnerSummary {
  runId: string;
  createdAt: string;
  handle: string;
  count: number;
  total: number;
  success: number;
  partial: number;
  failed: number;
  outputsDir: string;
  results: PostProcessResult[];
}
