// Profile pictures: a random image from the server plus the part of it shown in the circle.
//
// The crop is stored relative to the image (0..1), so it looks the same at any size and
// for everyone in the call. The image itself always comes from our own server
// (/api/avatars/<signed token>), never from a URL another participant made up.
import type { CSSProperties } from 'react';

export interface AvatarPick {
  /** Same-origin picture path from POST /api/avatars/random */
  src: string;
  /** Image width / height */
  ar: number;
  /** Centre of the circle, as a fraction of the image width / height */
  x: number;
  y: number;
  /** Circle diameter as a fraction of the image's shorter side (smaller = closer) */
  zoom: number;
}

export const MIN_ZOOM = 0.12;
const SRC_RE = /^\/api\/avatars\/[\w-]+\.[\w-]+$/;

/** Circle diameter in "image height = 1" units. */
const side = (a: Pick<AvatarPick, 'ar' | 'zoom'>) => a.zoom * Math.min(a.ar, 1);

/** Keeps the circle inside the picture. */
export function clampPick(a: AvatarPick): AvatarPick {
  const zoom = Math.min(1, Math.max(MIN_ZOOM, a.zoom));
  const c = side({ ar: a.ar, zoom });
  const clamp = (v: number, lo: number, hi: number) => (lo > hi ? 0.5 : Math.min(hi, Math.max(lo, v)));
  return {
    ...a,
    zoom,
    x: clamp(a.x, c / (2 * a.ar), 1 - c / (2 * a.ar)),
    y: clamp(a.y, c / 2, 1 - c / 2),
  };
}

/**
 * Where a character's head usually is: in portrait pictures near the top, centred.
 * Only a starting point - people drag the picture to fix it.
 */
export function defaultPick(src: string, ar: number): AvatarPick {
  if (ar < 0.9) {
    const zoom = 0.55;
    const c = side({ ar, zoom });
    return clampPick({ src, ar, zoom, x: 0.5, y: c / 2 + 0.06 });
  }
  return clampPick({ src, ar, zoom: 0.7, x: 0.5, y: 0.42 });
}

/** Position of the <img> inside a square, round frame (all in % of the frame). */
export function cropStyle(a: AvatarPick): CSSProperties {
  const c = side(a);
  return {
    position: 'absolute',
    width: `${(a.ar / c) * 100}%`,
    height: `${(1 / c) * 100}%`,
    left: `${(0.5 - (a.x * a.ar) / c) * 100}%`,
    top: `${(0.5 - a.y / c) * 100}%`,
    maxWidth: 'none',
  };
}

/** Moves the picture by a drag of (dx, dy) pixels in a frame `size` pixels wide. */
export function dragPick(a: AvatarPick, dx: number, dy: number, size: number): AvatarPick {
  const c = side(a);
  return clampPick({ ...a, x: a.x - (dx * c) / (size * a.ar), y: a.y - (dy * c) / size });
}

const num = (v: unknown, lo: number, hi: number) => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;

/** Validates a picture that came from storage or from another participant. */
export function parsePick(raw: unknown): AvatarPick | null {
  let v = raw;
  if (typeof v === 'string') {
    if (!v) return null;
    try {
      v = JSON.parse(v);
    } catch {
      return null;
    }
  }
  if (!v || typeof v !== 'object') return null;
  const a = v as Record<string, unknown>;
  if (typeof a.src !== 'string' || a.src.length > 3000 || !SRC_RE.test(a.src)) return null;
  if (!num(a.ar, 0.05, 20) || !num(a.x, 0, 1) || !num(a.y, 0, 1) || !num(a.zoom, 0.01, 1)) return null;
  return clampPick({ src: a.src, ar: a.ar as number, x: a.x as number, y: a.y as number, zoom: a.zoom as number });
}

/** Compact form for the participant attribute (rounded so it stays short). */
export const serializePick = (a: AvatarPick) =>
  JSON.stringify({
    src: a.src,
    ar: +a.ar.toFixed(4),
    x: +a.x.toFixed(4),
    y: +a.y.toFixed(4),
    zoom: +a.zoom.toFixed(4),
  });
