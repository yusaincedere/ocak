// Types shared by the server and the web app. Keep free of runtime imports.

export type Gender = 'male' | 'female';

export interface ServerConfig {
  /** Starting a call needs the server's create code. */
  createCodeRequired: boolean;
  /** Which kinds of random profile picture this server can hand out (empty: no pictures). */
  avatarGenders: Gender[];
}

/** A random profile picture. `src` is a same-origin path served by this server. */
export interface RandomAvatar {
  src: string;
  /** Size of the original image, when the picture API says so. */
  width: number | null;
  height: number | null;
}

export interface CreatedRoom {
  id: string;
  password: string;
}

export interface JoinResult {
  /** LiveKit URL to connect to */
  url: string;
  /** LiveKit access token */
  token: string;
  roomId: string;
}

/** Sent over the LiveKit data channel on this topic for remote-control (future). */
export const CONTROL_TOPIC = 'ocak-control';

// ---------- League of Legends helpers ----------

export type LolRole = 'TOP' | 'JUNGLE' | 'MIDDLE' | 'BOTTOM' | 'UTILITY';
export type LolLang = 'tr' | 'en';

/** Rank brackets the stats are kept in, lowest first (Master includes Grandmaster and Challenger). */
export const LOL_TIERS = ['GOLD', 'PLATINUM', 'EMERALD', 'DIAMOND', 'MASTER'] as const;
export type LolTier = (typeof LOL_TIERS)[number];
/** Stats are shown for a rank and everything above it ("Platinum+"). */
export const DEFAULT_LOL_RANK: LolTier = 'PLATINUM';
export const isLolTier = (v: unknown): v is LolTier => typeof v === 'string' && (LOL_TIERS as readonly string[]).includes(v);
/** "PLATINUM" → Platinum, Emerald, Diamond and Master. */
export const tiersFrom = (rank: LolTier): LolTier[] => LOL_TIERS.slice(LOL_TIERS.indexOf(rank));

export interface LolMeta {
  enabled: boolean;
  /** Data Dragon version, for icon URLs */
  version?: string;
  patch?: string;
  /** games collected for the newest patch with data */
  games?: number;
  champions?: { id: string; key: number; name: string }[];
}

export interface LolNamed {
  id: number;
  name: string;
}
export interface LolRune extends LolNamed {
  /** icon path under https://ddragon.leagueoflegends.com/cdn/img/ */
  icon: string;
}
export interface LolSpell extends LolNamed {
  /** icon file under /cdn/<version>/img/spell/ */
  image: string;
}

export interface LolBuild {
  champion: { id: string; key: number; name: string };
  patch: string;
  role: LolRole;
  roles: { role: LolRole; games: number; winRate: number }[];
  games: number;
  winRate: number;
  skills: { order: string; first: string | null } | null;
  /** Q/W/E/R names and icons (null if Data Dragon didn't have them) */
  abilities: { key: 'Q' | 'W' | 'E' | 'R'; name: string; image: string }[] | null;
  start: LolNamed[] | null;
  core: LolNamed[] | null;
  boots: LolNamed | null;
  runes: LolRunePage | null;
  spells: LolSpell[] | null;
  /**
   * Up to three ways people build this champion (keystone + core items), the recommended one
   * first; `core` and `runes` above are the first variant's.
   */
  variants: LolVariant[];
  counters: {
    /** champions this one loses to most */
    hard: LolCounter[];
    /** champions this one beats most */
    easy: LolCounter[];
  };
}

export interface LolRunePage {
  primary: LolRune;
  keystone: LolRune;
  primaryRunes: LolRune[];
  secondary: LolRune;
  secondaryRunes: LolRune[];
  shards: number[];
}

export interface LolVariant {
  games: number;
  winRate: number;
  /** share of this champion's games in this role, in percent */
  pickRate: number;
  core: LolNamed[] | null;
  runes: LolRunePage | null;
}

export interface LolCounter {
  champion: { id: string; key: number; name: string };
  games: number;
  winRate: number;
}

export interface LolPlayerStats {
  puuid: string;
  /** "Name#TAG" */
  riotId: string;
  /** Data Dragon champion id, e.g. "MonkeyKing" */
  champion: string;
  championKey: number;
  teamId: number;
  position: string;
  win: boolean;
  kills: number;
  deaths: number;
  assists: number;
  damage: number;
  damageTaken: number;
  mitigated: number;
  healing: number;
  gold: number;
  cs: number;
  vision: number;
  ccTime: number;
  level: number;
  largestMultiKill: number;
  pentaKills: number;
  quadraKills: number;
  killParticipation: number;
  soloKills: number;
  skillshotsDodged: number;
  items: number[];
  spells: number[];
}

export interface LolMatchSummary {
  id: string;
  queueId: number;
  /** seconds */
  duration: number;
  endedAt: number;
  version: string;
  players: LolPlayerStats[];
}

/** Sent over the call's data channel on this topic: "a game with one of us just ended". */
export const LOL_TOPIC = 'ocak-lol';
