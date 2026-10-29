// Everything about "you" lives in this browser / desktop app. No accounts.
import { DEFAULT_LOL_RANK, isLolTier, type Gender, type LolTier } from '../../server/src/protocol';
import { parsePick, serializePick, type AvatarPick } from './avatar';

// If local storage is cleared you just pick your name again.

const KEY = {
  device: 'ocak.device',
  name: 'ocak.name',
  rooms: 'ocak.rooms',
  createCode: 'ocak.createCode',
  lang: 'ocak.lang',
  avatar: 'ocak.avatar',
  gender: 'ocak.gender',
  volumes: 'ocak.volumes',
  noiseReduction: 'ocak.noiseReduction',
  chatSound: 'ocak.chatSound',
  riot: 'ocak.riot',
  lolRecent: 'ocak.lolRecent',
  lolRank: 'ocak.lolRank',
};

const memory = new Map<string, string>(); // fallback when storage is blocked (private mode etc.)

function read(key: string): string | null {
  try {
    return localStorage.getItem(key) ?? memory.get(key) ?? null;
  } catch {
    return memory.get(key) ?? null;
  }
}

function write(key: string, value: string | null) {
  if (value === null) memory.delete(key);
  else memory.set(key, value);
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* memory only */
  }
}

/** Random, stable per device. Lets the server tell two "Mert"s apart; never shown. */
export function deviceId(): string {
  let id = read(KEY.device);
  if (!id) {
    const bytes = crypto.getRandomValues(new Uint8Array(12));
    id = Array.from(bytes, (b) => b.toString(36).padStart(2, '0')).join('').slice(0, 20);
    write(KEY.device, id);
  }
  return id;
}

export const getName = () => read(KEY.name);
export const setName = (name: string) => write(KEY.name, name.trim().slice(0, 32));

/** UI language; Turkish unless the user picked English. */
export const getLang = (): 'tr' | 'en' => (read(KEY.lang) === 'en' ? 'en' : 'tr');
export const setLang = (lang: 'tr' | 'en') => write(KEY.lang, lang);

/** Profile picture (validated, since storage can be edited by hand). */
export const getAvatar = (): AvatarPick | null => parsePick(read(KEY.avatar));
export const setAvatar = (a: AvatarPick | null) => write(KEY.avatar, a ? serializePick(a) : null);

export const getGender = (): Gender | null => {
  const g = read(KEY.gender);
  return g === 'male' || g === 'female' ? g : null;
};
export const setGender = (g: Gender) => write(KEY.gender, g);

/** How loud each friend is for you (0..2, 1 = normal), keyed by their device. */
export function getVolumes(): Record<string, number> {
  try {
    const raw = JSON.parse(read(KEY.volumes) ?? '{}') as Record<string, unknown>;
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(raw)) if (typeof v === 'number' && v >= 0 && v <= 2 && k.length <= 64) out[k] = v;
    return out;
  } catch {
    return {};
  }
}
export const saveVolumes = (v: Record<string, number>) => write(KEY.volumes, JSON.stringify(v));

/** Noise reduction on the microphone: on unless turned off. */
export const getNoiseReduction = () => read(KEY.noiseReduction) !== 'off';
export const saveNoiseReduction = (on: boolean) => write(KEY.noiseReduction, on ? 'on' : 'off');
export const getChatSound = () => read(KEY.chatSound) !== 'off';
export const saveChatSound = (on: boolean) => write(KEY.chatSound, on ? 'on' : 'off');

/** League of Legends account for post-game cards: Riot ID ("Name#TAG") and server. */
export interface RiotAccount {
  riotId: string;
  platform: 'tr1' | 'euw1' | 'eun1';
}
export function getRiotAccount(): RiotAccount | null {
  try {
    const v = JSON.parse(read(KEY.riot) ?? 'null') as RiotAccount | null;
    return v && typeof v.riotId === 'string' && /^.{3,16}#[^\s#]{2,5}$/u.test(v.riotId) && ['tr1', 'euw1', 'eun1'].includes(v.platform) ? v : null;
  } catch {
    return null;
  }
}
export const saveRiotAccount = (a: RiotAccount | null) => write(KEY.riot, a ? JSON.stringify(a) : null);

/** Champions looked up recently in the LoL panel (Data Dragon ids). */
export function getRecentChampions(): string[] {
  try {
    const v = JSON.parse(read(KEY.lolRecent) ?? '[]') as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && /^[A-Za-z]{2,20}$/.test(x)).slice(0, 8) : [];
  } catch {
    return [];
  }
}
export const saveRecentChampions = (ids: string[]) => write(KEY.lolRecent, JSON.stringify(ids.slice(0, 8)));

/** Whose games the LoL stats come from: this rank and above. */
export function getLolRank(): LolTier {
  const v = read(KEY.lolRank);
  return isLolTier(v) ? v : DEFAULT_LOL_RANK;
}
export const saveLolRank = (rank: LolTier) => write(KEY.lolRank, rank);

export const getCreateCode = () => read(KEY.createCode);
export const setCreateCode = (code: string | null) => write(KEY.createCode, code);

export interface RecentRoom {
  id: string;
  password: string;
  lastUsed: number;
}

export function recentRooms(): RecentRoom[] {
  try {
    const list = JSON.parse(read(KEY.rooms) ?? '[]') as RecentRoom[];
    return Array.isArray(list) ? list.filter((r) => r && typeof r.id === 'string') : [];
  } catch {
    return [];
  }
}

export function rememberRoom(id: string, password: string) {
  const rest = recentRooms().filter((r) => r.id !== id);
  write(KEY.rooms, JSON.stringify([{ id, password, lastUsed: Date.now() }, ...rest].slice(0, 6)));
}

export function forgetRoom(id: string) {
  write(KEY.rooms, JSON.stringify(recentRooms().filter((r) => r.id !== id)));
}
