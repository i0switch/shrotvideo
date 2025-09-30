import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import process from 'node:process';
import { promisify } from 'util';
import ffmpeg from 'fluent-ffmpeg';

type FfprobeStream = {
  codec_type?: string;
  codec_name?: string;
};

interface RunMeta {
  total: number;
  success: number;
  partial: number;
  results: Array<{
    target: { tweetId: string; url: string };
    status: 'success' | 'partial' | 'failed';
    classification: { kind: string };
    screenshotPath: string;
    videoPath?: string;
    compositedPath?: string;
    metaPath: string;
  }>;
}

interface PostMeta {
  tweetId: string;
  type: string;
  selector: string;
  screenshotPath: string;
}

const ffprobeAsync = promisify(ffmpeg.ffprobe.bind(ffmpeg));

declare const __dirname: string;

interface RunDirCandidate {
  name: string;
  fullPath: string;
}

function findLatestRunDir(): string | undefined {
  const baseDir = path.resolve(__dirname, '../../outputs');
  if (!fs.existsSync(baseDir)) {
    return undefined;
  }

  const candidates: RunDirCandidate[] = fs
    .readdirSync(baseDir)
    .map<RunDirCandidate>((name) => ({
      name,
      fullPath: path.join(baseDir, name)
    }))
    .filter((entry) => entry.name.startsWith('final_run_') && fs.statSync(entry.fullPath).isDirectory())
    .sort((a, b) => fs.statSync(b.fullPath).mtimeMs - fs.statSync(a.fullPath).mtimeMs);

  return candidates[0]?.fullPath;
}

const outputRoot = process.env.APP_FINAL_OUTPUT
  ? path.resolve(process.env.APP_FINAL_OUTPUT)
  : findLatestRunDir();

test.describe('final artifacts verification', () => {
  test.skip(!outputRoot, '最終成果物が見つかりません。先に scripts/runFinal.js を実行してください。');

  test('run_meta.json の整合性', async () => {
    if (!outputRoot) {
      test.skip();
    }

    const runMetaPath = path.join(outputRoot!, 'run_meta.json');
    expect(fs.existsSync(runMetaPath), 'run_meta.json が存在すること').toBeTruthy();

    const runMeta = JSON.parse(fs.readFileSync(runMetaPath, 'utf-8')) as RunMeta;

    expect(runMeta.total).toBeGreaterThanOrEqual(10);
    expect(runMeta.success + runMeta.partial).toBe(runMeta.total);

    for (const result of runMeta.results) {
      const postDir = path.dirname(result.metaPath);
      expect(fs.existsSync(postDir), `ディレクトリ ${postDir} が存在`).toBeTruthy();

      const screenshotExists = fs.existsSync(result.screenshotPath);
      expect(screenshotExists, `スクリーンショット ${result.screenshotPath}`).toBeTruthy();

      const meta = JSON.parse(fs.readFileSync(result.metaPath, 'utf-8')) as PostMeta;
      expect(meta.tweetId).toBe(result.target.tweetId);
      expect(meta.selector.length).toBeGreaterThan(0);

      if (result.classification.kind === 'single_video') {
        expect(fs.existsSync(result.videoPath ?? ''), `動画 ${result.videoPath}`).toBeTruthy();
        expect(fs.existsSync(result.compositedPath ?? ''), `合成動画 ${result.compositedPath}`).toBeTruthy();

        const probe = (await ffprobeAsync(result.compositedPath!)) as unknown as {
          streams: FfprobeStream[];
        };
        const videoStream = probe.streams.find((stream) => stream.codec_type === 'video');
        const audioStream = probe.streams.find((stream) => stream.codec_type === 'audio');
        expect(videoStream?.codec_name).toBe('h264');
        expect(audioStream?.codec_name).toBe('aac');
      }
    }
  });
});
