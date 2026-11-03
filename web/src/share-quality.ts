import { ScreenSharePresets, type ScreenShareCaptureOptions, type TrackPublishOptions } from 'livekit-client';

export type ShareQuality = 'text' | 'balanced' | 'smooth' | 'original' | 'ultra';
export const SHARE_QUALITIES: ShareQuality[] = ['text', 'balanced', 'smooth', 'original', 'ultra'];
const KEY = 'ocak-share-quality';

export function getShareQuality(): ShareQuality {
  try {
    const saved = localStorage.getItem(KEY);
    return SHARE_QUALITIES.find((quality) => quality === saved) ?? 'balanced';
  } catch { return 'balanced'; }
}

export function saveShareQuality(quality: ShareQuality) {
  try { localStorage.setItem(KEY, quality); } catch { /* private storage can be unavailable */ }
}

export function shareSettings(quality: ShareQuality): {
  capture: ScreenShareCaptureOptions;
  publish: TrackPublishOptions;
} {
  const preset = quality === 'text' ? ScreenSharePresets.h1080fps15
    : quality === 'original' ? ScreenSharePresets.original
      : ScreenSharePresets.h1080fps30;
  const resolution = quality === 'original'
    ? ScreenSharePresets.original.resolution // zero dimensions explicitly bypass LiveKit's default 1080p cap
    : quality === 'ultra'
      ? { width: 3840, height: 2160, frameRate: 60 }
    : { ...preset.resolution, frameRate: quality === 'smooth' ? 60 : preset.resolution.frameRate };
  const encoding = quality === 'ultra'
    ? { maxBitrate: 20_000_000, maxFramerate: 60 }
    : quality === 'smooth'
      ? { maxBitrate: 8_000_000, maxFramerate: 60 }
    : preset.encoding;
  return {
    capture: {
      audio: true,
      systemAudio: 'include',
      selfBrowserSurface: 'exclude',
      surfaceSwitching: 'include',
      resolution,
      contentHint: quality === 'smooth' || quality === 'ultra' ? 'motion' : 'detail',
    },
    publish: { screenShareEncoding: encoding,
      degradationPreference: quality === 'smooth' || quality === 'ultra' ? 'maintain-framerate' : 'maintain-resolution' },
  };
}
