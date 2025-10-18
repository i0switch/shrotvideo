import { spawnSync } from 'node:child_process';
import ffmpegStatic from 'ffmpeg-static';

export async function mediaProbe(file: string): Promise<{ hasAudio: boolean; hasVideo: boolean; width?: number; height?: number; durationSec?: number; method: string; }>{
  const ffprobe = (ffmpegStatic as any) || 'ffprobe';
  try {
    const r = spawnSync('ffprobe', ['-v','error','-print_format','json','-show_streams','-show_format', file], { encoding: 'utf-8' });
    const out = r.stdout?.toString() || '';
    const j = JSON.parse(out);
    const streams = Array.isArray(j.streams) ? j.streams : [];
    const v = streams.find((s:any)=>s.codec_type==='video');
    const a = streams.find((s:any)=>s.codec_type==='audio');
    const hasVideo = !!v;
    const hasAudio = !!a;
    const width = v?.width; const height = v?.height;
    const durationSec = Number(j.format?.duration || v?.duration || 0) || undefined;
    return { hasAudio, hasVideo, width, height, durationSec, method: 'ffprobe' };
  } catch {
    return { hasAudio: false, hasVideo: false, method: 'none' } as any;
  }
}
