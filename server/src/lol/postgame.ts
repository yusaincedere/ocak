// Post-game cards: find a player's latest game by Riot ID and summarize it.
import { db } from '../db.js';
import type { LolMatchSummary, LolPlayerStats } from '../protocol.js';
import type { Match } from './extract.js';
import { platformOfMatch, regionOf, RiotError, type RiotClient } from './riot.js';

db.exec(`
  CREATE TABLE IF NOT EXISTS lol_accounts (
    riot_id TEXT PRIMARY KEY, puuid TEXT NOT NULL, game_name TEXT NOT NULL, tag_line TEXT NOT NULL, at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS lol_match_cache (id TEXT PRIMARY KEY, json TEXT NOT NULL, at INTEGER NOT NULL);
`);

const DAY = 24 * 60 * 60 * 1000;

/** "Name#TAG" → parts, or null. Riot names are 3-16 chars, tags 3-5. */
export function parseRiotId(raw: string): { gameName: string; tagLine: string } | null {
  const m = raw.trim().match(/^(.{3,16})#([^\s#]{2,5})$/u);
  return m ? { gameName: m[1]!.trim(), tagLine: m[2]! } : null;
}

export const MATCH_ID = /^[A-Z0-9]{2,5}_\d{5,15}$/;

interface Account {
  puuid: string;
  gameName: string;
  tagLine: string;
}

export async function resolveAccount(riot: RiotClient, riotId: string): Promise<Account | null> {
  const parsed = parseRiotId(riotId);
  if (!parsed) return null;
  const key = `${parsed.gameName}#${parsed.tagLine}`.toLowerCase();
  const cached = db.prepare('SELECT puuid, game_name, tag_line, at FROM lol_accounts WHERE riot_id = ?').get(key) as
    | { puuid: string; game_name: string; tag_line: string; at: number }
    | undefined;
  if (cached && Date.now() - cached.at < 7 * DAY) return { puuid: cached.puuid, gameName: cached.game_name, tagLine: cached.tag_line };
  try {
    // Accounts are global; any region answers.
    const acc = await riot.get<Account>(
      'europe',
      `/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(parsed.gameName)}/${encodeURIComponent(parsed.tagLine)}`,
    );
    db.prepare(
      'INSERT INTO lol_accounts (riot_id, puuid, game_name, tag_line, at) VALUES (?, ?, ?, ?, ?) ON CONFLICT DO UPDATE SET puuid = excluded.puuid, game_name = excluded.game_name, tag_line = excluded.tag_line, at = excluded.at',
    ).run(key, acc.puuid, acc.gameName, acc.tagLine, Date.now());
    return acc;
  } catch (err) {
    if (err instanceof RiotError && err.status === 404) return null;
    throw err;
  }
}

/** A player's most played champions (by mastery points), cached for a few hours. */
const mainsCache = new Map<string, { at: number; keys: number[] }>();
export async function mainChampions(riot: RiotClient, account: Account, platform: string, count = 5): Promise<number[]> {
  const key = `${platform}:${account.puuid}`;
  const hit = mainsCache.get(key);
  if (hit && Date.now() - hit.at < 6 * 60 * 60 * 1000) return hit.keys;
  const rows = await riot.get<{ championId: number }[]>(
    platform,
    `/lol/champion-mastery/v4/champion-masteries/by-puuid/${encodeURIComponent(account.puuid)}/top?count=${count}`,
  );
  const keys = rows.map((r) => r.championId);
  mainsCache.set(key, { at: Date.now(), keys });
  if (mainsCache.size > 500) mainsCache.delete(mainsCache.keys().next().value!);
  return keys;
}

/** The id of the player's most recent finished game (any mode) on their region. */
export async function latestMatchId(riot: RiotClient, account: Account, platform: string): Promise<string | null> {
  const ids = await riot.get<string[]>(
    regionOf(platform),
    `/lol/match/v5/matches/by-puuid/${encodeURIComponent(account.puuid)}/ids?start=0&count=1`,
  );
  return ids[0] ?? null;
}

const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

export function summarize(match: Match): LolMatchSummary {
  const players: LolPlayerStats[] = match.info.participants.map((p) => {
    const c = p.challenges ?? {};
    return {
      puuid: p.puuid,
      riotId: p.riotIdGameName ? `${p.riotIdGameName}#${p.riotIdTagline ?? ''}` : '',
      champion: p.championName,
      championKey: p.championId,
      teamId: p.teamId,
      position: p.teamPosition || '',
      win: p.win,
      kills: n(p.kills),
      deaths: n(p.deaths),
      assists: n(p.assists),
      damage: n(p.totalDamageDealtToChampions),
      damageTaken: n(p.totalDamageTaken),
      mitigated: n(p.damageSelfMitigated),
      healing: n(p.totalHealsOnTeammates),
      gold: n(p.goldEarned),
      cs: n(p.totalMinionsKilled) + n(p.neutralMinionsKilled),
      vision: n(p.visionScore),
      ccTime: n(p.timeCCingOthers),
      level: n(p.champLevel),
      largestMultiKill: n(p.largestMultiKill),
      pentaKills: n(p.pentaKills),
      quadraKills: n(p.quadraKills),
      killParticipation: n(c.killParticipation),
      soloKills: n(c.soloKills),
      skillshotsDodged: n(c.skillshotsDodged),
      items: [p.item0, p.item1, p.item2, p.item3, p.item4, p.item5, p.item6].map(n),
      spells: [n(p.summoner1Id), n(p.summoner2Id)],
    };
  });
  return {
    id: match.metadata.matchId,
    queueId: match.info.queueId,
    duration: match.info.gameDuration,
    endedAt: match.info.gameEndTimestamp ?? (match.info.gameCreation ?? 0) + match.info.gameDuration * 1000,
    version: match.info.gameVersion,
    players,
  };
}

export async function matchSummary(riot: RiotClient, id: string): Promise<LolMatchSummary> {
  const cached = db.prepare('SELECT json FROM lol_match_cache WHERE id = ?').get(id) as { json: string } | undefined;
  if (cached) return JSON.parse(cached.json) as LolMatchSummary;
  const match = await riot.get<Match>(regionOf(platformOfMatch(id)), `/lol/match/v5/matches/${id}`);
  const summary = summarize(match);
  db.prepare('INSERT OR REPLACE INTO lol_match_cache (id, json, at) VALUES (?, ?, ?)').run(id, JSON.stringify(summary), Date.now());
  db.prepare('DELETE FROM lol_match_cache WHERE at < ?').run(Date.now() - 7 * DAY);
  return summary;
}
