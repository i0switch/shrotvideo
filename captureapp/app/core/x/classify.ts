import { ClassificationResult } from '@core/types';

export function classifyFromFlags(flags: {
  hasVideo: boolean;
  hasMultipleVideos: boolean;
  hasImage: boolean;
}): ClassificationResult {
  if (flags.hasVideo) {
    return {
      kind: flags.hasMultipleVideos ? 'multi_video' : 'single_video',
      hasVideo: true,
      hasMultipleVideos: flags.hasMultipleVideos,
      hasImage: flags.hasImage
    };
  }

  if (flags.hasImage) {
    return {
      kind: 'image',
      hasVideo: false,
      hasMultipleVideos: false,
      hasImage: true
    };
  }

  return {
    kind: 'text',
    hasVideo: false,
    hasMultipleVideos: false,
    hasImage: false
  };
}
