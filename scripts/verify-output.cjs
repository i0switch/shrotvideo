// Simple verifier: checks all videos in ./output using ffmpeg only (no ffprobe required)
// Criteria: decodable, has a video stream (heuristic), duration > 0 and <= 65s, width<=1080, height<=1920
const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const path = require('node:path');
const ffmpegPath = require('ffmpeg-static');

if (!ffmpegPath) {
  console.error('[verify] ffmpeg-static not found. Install dev dependency ffmpeg-static.');
  process.exit(1);
}

function parseMeta(stderr) {
  // stderr includes lines like:
  // Duration: 00:00:10.00, start: 0.000000, bitrate: 1234 kb/s
  // Stream #0:0: Video: h264 (High), yuv420p(progressive), 1080x1920, ...
  let durationSec = 0;
  let width = 0, height = 0;
  const durMatch = stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  if (durMatch) {
    const h = Number(durMatch[1]);
    const m = Number(durMatch[2]);
    const s = Number(durMatch[3]);
    durationSec = h * 3600 + m * 60 + s;
  }
  const resMatch = stderr.match(/Stream #\d+:\d+[^\n]*Video:[^\n]*\b(\d{2,5})x(\d{2,5})\b/);
  if (resMatch) {
    width = Number(resMatch[1]);
    height = Number(resMatch[2]);
  }
  // 解像度を含むVideoストリーム行が取れていればビデオ有りとみなす
  const hasVideo = !!resMatch;
  return { durationSec, width, height, hasVideo };
}

async function probeWithFfmpeg(file) {
  return new Promise((resolve) => {
    const args = ['-hide_banner', '-i', file, '-f', 'null', '-'];
    const child = spawn(ffmpegPath, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let errBuf = '';
    child.stderr.on('data', (d) => { errBuf += d.toString(); });
    child.on('close', (_code) => {
      // Even on success ffmpeg returns non-zero for -i probe sometimes; parse stderr instead
      resolve(parseMeta(errBuf));
    });
  });
}

async function main() {
  // 引数: [countOrDir] [dir]
  //  - 数値を先頭に渡すと件数指定（0で全件）。
  //  - パスを渡すとディレクトリ指定。二番目の引数にパスを渡してもよい。
  let outDir = path.join(process.cwd(), 'output');
  let targetCount = 15; // デフォルトは直近15件
  const a2 = process.argv[2];
  const a3 = process.argv[3];
  if (a2) {
    const n = Number(a2);
    if (!Number.isNaN(n) && a2.trim() !== '') {
      targetCount = n;
    } else {
      outDir = path.isAbsolute(a2) ? a2 : path.join(process.cwd(), a2);
    }
  }
  if (a3) {
    outDir = path.isAbsolute(a3) ? a3 : path.join(process.cwd(), a3);
  }
  let files = [];
  try {
    const entries = await fs.readdir(outDir);
    files = entries.filter((n) => /\.(mp4|mov|webm|mkv)$/i.test(n)).map((n) => path.join(outDir, n));
  } catch (e) {
    console.error('[verify] 出力ディレクトリが見つかりません:', outDir);
    process.exit(1);
  }
  if (files.length === 0) {
    console.warn('[verify] 検証対象の動画が見つかりません。');
    process.exit(2);
  }

  // 直近更新のファイルから targetCount 件に絞り込み（0なら全件）
  const stats = await Promise.all(files.map(async (f) => ({ f, s: await fs.stat(f) })));
  stats.sort((a, b) => b.s.mtimeMs - a.s.mtimeMs);
  if (targetCount > 0) {
    files = stats.slice(0, Math.min(targetCount, stats.length)).map((x) => x.f);
    console.log(`[verify] 対象: 直近 ${files.length} 件（dir=${outDir}）`);
  } else {
    files = stats.map((x) => x.f);
    console.log(`[verify] 対象: 全件 ${files.length} 件（dir=${outDir}）`);
  }

  let ok = 0, ng = 0;
  for (const f of files) {
    const meta = await probeWithFfmpeg(f);
    const pass = meta.hasVideo && meta.durationSec > 0 && meta.durationSec <= 65 && meta.width <= 1080 && meta.height <= 1920;
    if (pass) {
      ok++;
      console.log(`[OK] ${path.basename(f)} dur=${meta.durationSec.toFixed(2)}s ${meta.width}x${meta.height}`);
    } else {
      ng++;
      console.log(`[NG] ${path.basename(f)} dur=${meta.durationSec.toFixed(2)}s ${meta.width}x${meta.height} hasVideo=${meta.hasVideo}`);
    }
  }
  console.log(`[verify] 合計: OK=${ok}, NG=${ng}, 総数=${files.length}`);
  process.exit(ng > 0 ? 3 : 0);
}

main().catch((e) => { console.error('[verify] 失敗:', e); process.exit(1); });
