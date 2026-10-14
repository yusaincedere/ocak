import { createHash, randomInt, timingSafeEqual } from 'node:crypto';
import { EN_WORDS, TR_WORDS } from './words.js';

// No 0/o, 1/l/i: easy to read out loud or type from a screenshot.
const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

function randomString(len: number) {
  let s = '';
  for (let i = 0; i < len; i++) s += ALPHABET[randomInt(ALPHABET.length)];
  return s;
}

export type RoomLang = 'tr' | 'en';

/** e.g. "limon3" (Turkish) or "lemon3" (English): easy to say out loud. */
export function newRoomId(lang: RoomLang = 'tr', maxNumber = 99): string {
  const words = lang === 'en' ? EN_WORDS : TR_WORDS;
  return `${words[randomInt(words.length)]}${randomInt(1, maxNumber + 1)}`;
}
/** e.g. "h3x9tw" */
export const newRoomPassword = () => randomString(6);

const WORD_ID = /^[a-z]{2,16}\d{1,4}$/;

/**
 * Every room ID a typed or pasted value could mean, best guess first.
 * New rooms are "limon3"; rooms made before word names were "k7m2-qp4x" and keep working.
 * Accepts any case, spaces and dashes: "Limon 3", "LIMON3", "K7M2QP4X", "k7m2 qp4x".
 */
export function roomIdCandidates(raw: string): string[] {
  // Turkish keyboards: "LİMON" lowercases to "i̇" and "ı" isn't ASCII; both mean a plain i here.
  const s = raw.replace(/[İı]/g, 'i').toLowerCase().replace(/[^a-z0-9]/g, '');
  const out: string[] = [];
  if (WORD_ID.test(s)) out.push(s);
  if (s.length === 8 && [...s].every((c) => ALPHABET.includes(c))) out.push(`${s.slice(0, 4)}-${s.slice(4)}`);
  return out;
}

// Passwords are random (not user-chosen), so a fast hash is fine; we just don't keep them in clear.
export const hashPassword = (pw: string) => createHash('sha256').update(`ocak:${pw.trim().toLowerCase()}`).digest('hex');

export function passwordMatches(pw: string, hash: string) {
  const a = Buffer.from(hashPassword(pw), 'hex');
  const b = Buffer.from(hash, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}
