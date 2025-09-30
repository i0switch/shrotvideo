import fs from 'fs';
import path from 'path';
import { ClassificationResult, MediaBoundingBox, PostProcessResult } from '@core/types';

export interface PostMeta {
  url: string;
  tweetId: string;
  type: ClassificationResult['kind'];
  selector: string;
  screenshotPath: string;
  videoPath?: string;
  compositedPath?: string;
  boundingBox?: MediaBoundingBox;
  attempts: number;
  status: PostProcessResult['status'];
  errors: string[];
  downloadedFrom?: string;
  createdAt: string;
}

export function writeJson(filePath: string, data: unknown) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

export function writePostMeta(result: PostProcessResult, selector: string, downloadUrl?: string) {
  const meta: PostMeta = {
    url: result.target.url,
    tweetId: result.target.tweetId,
    type: result.classification.kind,
    selector,
    screenshotPath: result.screenshotPath,
    videoPath: result.videoPath,
    compositedPath: result.compositedPath,
    boundingBox: result.boundingBox,
    attempts: result.attempts,
    status: result.status,
    errors: result.errors,
    downloadedFrom: downloadUrl,
    createdAt: new Date().toISOString()
  };

  writeJson(result.metaPath, meta);
}
