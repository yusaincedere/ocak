// Small bits of state everyone in the call can see, carried as LiveKit participant attributes
// (nothing is stored on the server; they disappear when you leave).
import type { LocalParticipant, Participant } from 'livekit-client';

const DEAFENED = 'ocak.deafened';
/** Push-to-talk users are "muted" between key presses; don't show them as muted. */
const PTT = 'ocak.ptt';

export const isDeafened = (p: Participant) => p.attributes?.[DEAFENED] === '1';
export const usesPushToTalk = (p: Participant) => p.attributes?.[PTT] === '1';

export function setPresence(local: LocalParticipant, presence: { deafened?: boolean; ptt?: boolean }) {
  const attrs: Record<string, string> = {};
  if (presence.deafened !== undefined) attrs[DEAFENED] = presence.deafened ? '1' : '';
  if (presence.ptt !== undefined) attrs[PTT] = presence.ptt ? '1' : '';
  return local.setAttributes(attrs).catch(() => {});
}

/** The device part of an identity ("<deviceId>:<suffix>"), so a person keeps their color across calls. */
const deviceOf = (identity: string) => identity.split(':')[0] ?? identity;

// Muted, warm-leaning palette that reads well on the dark background.
const COLORS = ['#f2994a', '#e5c35a', '#7bc96f', '#4fc1a6', '#56b4e9', '#7c8cf8', '#b48cf2', '#ec7aa8', '#ef6f6c', '#a3b86c'];

export function colorFor(identity: string): string {
  let h = 0;
  for (const ch of deviceOf(identity)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return COLORS[h % COLORS.length]!;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  const first = Array.from(parts[0]!)[0] ?? '?';
  const second = parts.length > 1 ? (Array.from(parts[parts.length - 1]!)[0] ?? '') : '';
  return (first + second).toLocaleUpperCase();
}
