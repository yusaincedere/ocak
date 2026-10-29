// Turns one Riot match (and its timeline) into what we aggregate: per player, the build they
// went (skill max order, starting items, first three core items, boots, runes, summoner
// spells) and who they laned against. Pure functions, no I/O.
import { isBoots, isCoreItem, type ItemInfo } from './ddragon.js';

// ---- the parts of match-v5 we use ----

export interface MatchParticipant {
  participantId: number;
  puuid: string;
  riotIdGameName?: string;
  riotIdTagline?: string;
  championId: number;
  championName: string;
  teamId: number;
  teamPosition: string; // TOP | JUNGLE | MIDDLE | BOTTOM | UTILITY | ''
  win: boolean;
  kills: number;
  deaths: number;
  assists: number;
  totalDamageDealtToChampions: number;
  totalDamageTaken: number;
  damageSelfMitigated?: number;
  totalHeal?: number;
  totalHealsOnTeammates?: number;
  goldEarned: number;
  totalMinionsKilled: number;
  neutralMinionsKilled: number;
  visionScore: number;
  wardsPlaced?: number;
  timeCCingOthers?: number;
  largestMultiKill?: number;
  pentaKills?: number;
  quadraKills?: number;
  champLevel?: number;
  item0?: number;
  item1?: number;
  item2?: number;
  item3?: number;
  item4?: number;
  item5?: number;
  item6?: number;
  summoner1Id: number;
  summoner2Id: number;
  perks?: {
    statPerks?: { offense: number; flex: number; defense: number };
    styles?: { description: string; style: number; selections: { perk: number }[] }[];
  };
  challenges?: Record<string, number | number[] | undefined>;
}

export interface Match {
  metadata: { matchId: string };
  info: {
    gameVersion: string;
    queueId: number;
    gameDuration: number; // seconds
    gameEndTimestamp?: number;
    gameCreation?: number;
    participants: MatchParticipant[];
  };
}

export interface TimelineEvent {
  type: string;
  participantId?: number;
  itemId?: number;
  beforeId?: number;
  afterId?: number;
  skillSlot?: number;
  timestamp: number;
}

export interface Timeline {
  info: { frames: { events: TimelineEvent[] }[] };
}

export const ROLES = ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY'] as const;
export type Role = (typeof ROLES)[number];
const isRole = (r: string): r is Role => (ROLES as readonly string[]).includes(r);

/** "15.21.712.5555" → "15.21" */
export const patchOfGameVersion = (v: string) => v.split('.').slice(0, 2).join('.');

/** Remakes and very short games don't say anything about builds. */
export const isUsableGame = (m: Match) => m.info.gameDuration >= 15 * 60 && m.info.participants.length === 10;

export interface BuildRecord {
  champion: number;
  role: Role;
  win: boolean;
  /** e.g. "QEW": the order abilities were maxed */
  skillOrder: string | null;
  /** e.g. "QWE": abilities taken at levels 1-3 */
  firstSkills: string | null;
  /** sorted item ids bought in the first 90 seconds, e.g. "1055,2003" */
  start: string | null;
  /** first three core items in purchase order, e.g. "6672,3046,3036" */
  core: string | null;
  boots: string | null;
  /** full rune page, see runeKey() */
  runes: string | null;
  /** sorted summoner spell ids, e.g. "4,14" */
  spells: string;
  /** keystone + first core item, e.g. "8112:6655": tells build variants apart (AP vs AD, Electrocute vs Comet) */
  variant: string | null;
  /** champion of the same role on the other team */
  opponent: number | null;
}

const LETTERS = ['', 'Q', 'W', 'E', 'R'];

/** Max order from the sequence of ability level-ups (1=Q, 2=W, 3=E, 4=R). */
export function skillOrder(slots: number[]): { order: string | null; first: string | null } {
  const basic = slots.filter((s) => s >= 1 && s <= 3);
  const first = basic.length >= 3 ? basic.slice(0, 3).map((s) => LETTERS[s]).join('') : null;
  const points = [0, 0, 0, 0];
  const maxed: number[] = [];
  for (const s of basic) {
    points[s]!++;
    if (points[s] === 5) maxed.push(s);
  }
  if (!maxed.length) return { order: null, first };
  // Games often end before the last ability is maxed: rank the rest by points (ties: earlier first).
  const rest = [1, 2, 3].filter((s) => !maxed.includes(s)).sort((a, b) => points[b]! - points[a]!);
  return { order: [...maxed, ...rest].map((s) => LETTERS[s]).join(''), first };
}

/** Purchases minus undone ones, in order. */
export function purchases(events: TimelineEvent[]): { itemId: number; timestamp: number }[] {
  const out: { itemId: number; timestamp: number }[] = [];
  for (const e of events) {
    if (e.type === 'ITEM_PURCHASED' && e.itemId) out.push({ itemId: e.itemId, timestamp: e.timestamp });
    else if (e.type === 'ITEM_UNDO' && e.beforeId) {
      for (let i = out.length - 1; i >= 0; i--)
        if (out[i]!.itemId === e.beforeId) {
          out.splice(i, 1);
          break;
        }
    }
  }
  return out;
}

export function itemPath(bought: { itemId: number; timestamp: number }[], items: Map<number, ItemInfo>) {
  const start = bought.filter((b) => b.timestamp < 90_000).map((b) => b.itemId);
  const core: number[] = [];
  let boots: number | null = null;
  for (const { itemId } of bought) {
    const info = items.get(itemId);
    if (boots === null && isBoots(info)) boots = itemId;
    else if (isCoreItem(info) && !core.includes(itemId) && core.length < 3) core.push(itemId);
  }
  return {
    start: start.length ? [...start].sort((a, b) => a - b).join(',') : null,
    core: core.length === 3 ? core.join(',') : null,
    boots: boots === null ? null : String(boots),
  };
}

/** "8100:8112-8139-8138-8135|8300:8304-8345|5008-5008-5011" (secondary runes sorted). */
export function runeKey(perks: MatchParticipant['perks']): string | null {
  const styles = perks?.styles;
  const primary = styles?.find((s) => s.description === 'primaryStyle');
  const sub = styles?.find((s) => s.description === 'subStyle');
  const shards = perks?.statPerks;
  if (!primary || !sub || !shards || primary.selections.length !== 4 || sub.selections.length !== 2) return null;
  const subPerks = sub.selections.map((s) => s.perk).sort((a, b) => a - b);
  return `${primary.style}:${primary.selections.map((s) => s.perk).join('-')}|${sub.style}:${subPerks.join('-')}|${shards.offense}-${shards.flex}-${shards.defense}`;
}

export function parseRuneKey(key: string) {
  const m = key.match(/^(\d+):([\d-]+)\|(\d+):([\d-]+)\|([\d-]+)$/);
  if (!m) return null;
  return {
    primaryStyle: Number(m[1]),
    primary: m[2]!.split('-').map(Number),
    subStyle: Number(m[3]),
    sub: m[4]!.split('-').map(Number),
    shards: m[5]!.split('-').map(Number),
  };
}

/** One build record per player in a usable game. */
export function extractBuilds(match: Match, timeline: Timeline, items: Map<number, ItemInfo>): BuildRecord[] {
  const events = timeline.info.frames.flatMap((f) => f.events);
  const players = match.info.participants;
  const out: BuildRecord[] = [];
  for (const p of players) {
    if (!isRole(p.teamPosition)) continue;
    const mine = events.filter((e) => e.participantId === p.participantId);
    const skills = skillOrder(mine.filter((e) => e.type === 'SKILL_LEVEL_UP').map((e) => e.skillSlot ?? 0));
    const path = itemPath(purchases(mine), items);
    const opponent = players.find((o) => o.teamId !== p.teamId && o.teamPosition === p.teamPosition);
    const runes = runeKey(p.perks);
    const keystone = runes ? parseRuneKey(runes)?.primary[0] : undefined;
    out.push({
      champion: p.championId,
      role: p.teamPosition,
      win: p.win,
      skillOrder: skills.order,
      firstSkills: skills.first,
      ...path,
      runes,
      spells: [p.summoner1Id, p.summoner2Id].sort((a, b) => a - b).join(','),
      variant: keystone && path.core ? `${keystone}:${path.core.split(',')[0]}` : null,
      opponent: opponent?.championId ?? null,
    });
  }
  return out;
}
