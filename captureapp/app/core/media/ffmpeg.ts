import ffmpegPath from 'ffmpeg-static';
import ffmpeg from 'fluent-ffmpeg';

let configured = false;

export function getFfmpegCommand() {
  if (!configured) {
    if (ffmpegPath) {
      ffmpeg.setFfmpegPath(ffmpegPath);
    }
    configured = true;
  }
  return ffmpeg;
}
