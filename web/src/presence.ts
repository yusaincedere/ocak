// Small bits of state everyone in the call can see, carried as LiveKit participant attributes
// (nothing is stored on the server; they disappear when you leave).
import type { LocalParticipant, Participant } from 'livekit-client';
import { parsePick, serializePick, type AvatarPick } from './avatar';
import { parseNameStyle, serializeNameStyle, type NameStyle } from './name-style';

const DEAFENED = 'ocak.deafened';
/** Push-to-talk users are "muted" between key presses; don't show them as muted. */
const PTT = 'ocak.ptt';
const AVATAR = 'ocak.avatar';
/** Riot ID ("Name#TAG"), so post-game cards know who in the game is one of us. */
const RIOT = 'ocak.riot';
/** Look of a pasted name (validated again by everyone who shows it). */
const NAME_STYLE = 'ocak.nameStyle';
/** Set by the server when an admin changes someone's voice: "child:<until, ms since epoch>". */
export const VOICE = 'ocak.voice';

/** A voice effect an admin put on this person, while it lasts. */
export function voiceEffectOf(attributes: Record<string, string> | undefined, now = Date.now()): { effect: 'child'; until: number } | null {
  const m = /^child:(\d+)$/.exec(attributes?.[VOICE] ?? '');
  const until = m ? Number(m[1]) : 0;
  return until > now ? { effect: 'child', until } : null;
}

export const isDeafened = (p: Participant) => p.attributes?.[DEAFENED] === '1';
export const usesPushToTalk = (p: Participant) => p.attributes?.[PTT] === '1';
/** Someone's profile picture; only same-origin pictures from our server are accepted. */
export const avatarOf = (p: Participant): AvatarPick | null => parsePick(p.attributes?.[AVATAR]);

/** Someone's name style from their attributes; only while it spells their current name. */
export const nameStyleFrom = (attributes: Record<string, string> | undefined, name: string | undefined): NameStyle | null =>
  parseNameStyle(attributes?.[NAME_STYLE], name);

export type PersonState = 'deafened' | 'micOff' | 'silenced' | 'ptt';

/** Show mute and deafen independently; the personal volume state is secondary to both. */
export function personState(p: { deafened: boolean; micOff: boolean; silencedForMe: boolean; ptt: boolean }): PersonState[] {
  const states: PersonState[] = [];
  if (p.micOff) states.push('micOff');
  if (p.deafened) states.push('deafened');
  if (!states.length && p.silencedForMe) states.push('silenced');
  if (!states.length && p.ptt) states.push('ptt');
  return states;
}

/** Someone's Riot account ("Name#TAG|tr1" in the attribute). */
export function riotOf(p: Participant): { riotId: string; platform: string } | null {
  const m = p.attributes?.[RIOT]?.match(/^(.{3,16}#[^\s#|]{2,5})(?:\|([a-z]{2,4}\d?))?$/u);
  return m ? { riotId: m[1]!, platform: m[2] ?? 'tr1' } : null;
}
export const riotIdOf = (p: Participant) => riotOf(p)?.riotId ?? null;

/**
 * LiveKit's setAttributes sends the name along too, the one last confirmed by the server: an
 * attribute update that goes out while a rename is still on its way puts the old name back.
 * So every update waits for the one before it, and a rename is confirmed before anything else.
 */
const queues = new WeakMap<LocalParticipant, Promise<void>>();

export function setPresence(
  local: LocalParticipant,
  presence: {
    name?: string | null;
    deafened?: boolean;
    ptt?: boolean;
    avatar?: AvatarPick | null;
    riot?: { riotId: string; platform: string } | null;
    nameStyle?: NameStyle | null;
  },
) {
  const attrs: Record<string, string> = {};
  if (presence.deafened !== undefined) attrs[DEAFENED] = presence.deafened ? '1' : '';
  if (presence.ptt !== undefined) attrs[PTT] = presence.ptt ? '1' : '';
  if (presence.avatar !== undefined) attrs[AVATAR] = presence.avatar ? serializePick(presence.avatar) : '';
  if (presence.nameStyle !== undefined) attrs[NAME_STYLE] = serializeNameStyle(presence.nameStyle);
  if (presence.riot !== undefined) attrs[RIOT] = presence.riot ? `${presence.riot.riotId}|${presence.riot.platform}` : '';
  const run = async () => {
    if (presence.name && presence.name !== local.name) await local.setName(presence.name).catch(() => {});
    if (Object.keys(attrs).length) await local.setAttributes(attrs).catch(() => {});
  };
  const next = (queues.get(local) ?? Promise.resolve()).then(run);
  queues.set(local, next);
  return next;
}

/** The device part of an identity ("<deviceId>:<suffix>"), so a person keeps their color across calls. */
export const deviceOf = (identity: string) => identity.split(':')[0] ?? identity;

// Muted, warm-leaning palette that reads well on the dark background.
const COLORS = ['#f2994a', '#e5c35a', '#7bc96f', '#4fc1a6', '#56b4e9', '#7c8cf8', '#b48cf2', '#ec7aa8', '#ef6f6c', '#a3b86c'];

const preferred = (device: string) => {
  let h = 0;
  for (const ch of device) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h % COLORS.length;
};

/** Colors handed out in the current call (device id → color), so two people never share one. */
let assigned = new Map<string, string>();

/**
 * Gives everyone in the call their own color. Each person gets their usual color unless someone
 * already has it, then the next free one; people are taken in device-id order, so every screen
 * comes to the same result. People who left keep theirs (their chat messages stay the same color).
 */
export function assignColors(identities: string[]) {
  const devices = [...new Set(identities.map(deviceOf))].sort();
  const next = new Map<string, string>();
  const taken = new Set<string>();
  // The palette goes around the color wheel, so distance in it is distance in hue.
  const n = COLORS.length;
  const gap = (i: number, j: number) => Math.min(Math.abs(i - j), n - Math.abs(i - j));
  for (const d of devices) {
    const start = preferred(d);
    let pick = start;
    if (taken.has(COLORS[start]!)) {
      // Taken: the free color that looks most different from the ones already in use.
      const used = [...taken].map((c) => COLORS.indexOf(c));
      let best = -1;
      for (let k = 0; k < n; k++) {
        const i = (start + k) % n;
        if (taken.has(COLORS[i]!)) continue;
        const score = Math.min(...used.map((u) => gap(i, u)));
        if (score > best) [best, pick] = [score, i];
      }
    }
    taken.add(COLORS[pick]!);
    next.set(d, COLORS[pick]!);
  }
  for (const [d, c] of assigned) if (!next.has(d)) next.set(d, c);
  assigned = next;
}

/** Forget the call's colors (after leaving it). */
export const resetColors = () => {
  assigned = new Map();
};

export function colorFor(identity: string): string {
  const device = deviceOf(identity);
  return assigned.get(device) ?? COLORS[preferred(device)]!;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  const first = Array.from(parts[0]!)[0] ?? '?';
  const second = parts.length > 1 ? (Array.from(parts[parts.length - 1]!)[0] ?? '') : '';
  return (first + second).toLocaleUpperCase();
}
