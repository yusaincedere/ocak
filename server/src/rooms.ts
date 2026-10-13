import { createHash, randomInt, timingSafeEqual } from 'node:crypto';

// No 0/o, 1/l/i: easy to read out loud or type from a screenshot.
const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

function randomString(len: number) {
  let s = '';
  for (let i = 0; i < len; i++) s += ALPHABET[randomInt(ALPHABET.length)];
  return s;
}

/** e.g. "k7m2-qp4x" */
export const newRoomId = () => `${randomString(4)}-${randomString(4)}`;
/** e.g. "h3x9tw" */
export const newRoomPassword = () => randomString(6);

/** Accepts "K7M2QP4X", "k7m2 qp4x", "k7m2-qp4x" → "k7m2-qp4x". */
export function normalizeRoomId(raw: string): string | null {
  const s = raw.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (s.length !== 8 || [...s].some((c) => !ALPHABET.includes(c))) return null;
  return `${s.slice(0, 4)}-${s.slice(4)}`;
}

// Passwords are random (not user-chosen), so a fast hash is fine; we just don't keep them in clear.
export const hashPassword = (pw: string) => createHash('sha256').update(`ocak:${pw.trim().toLowerCase()}`).digest('hex');

export function passwordMatches(pw: string, hash: string) {
  const a = Buffer.from(hashPassword(pw), 'hex');
  const b = Buffer.from(hash, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}
