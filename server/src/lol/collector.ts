// Background job that builds our own build/counter statistics from ranked games, Gold to Challenger.
//
//  1. Every few hours, take the players of Master+ and the first ladder page of every Gold,
//     Platinum, Emerald and Diamond division on each configured server, with their rank.
//  2. One player at a time, taking turns between ranks so every range fills: look at their latest
//     ranked solo games; every game on the current patch we haven't seen yet is read with its
//     timeline and added to the stats under that player's rank.
//  3. Players met in those games join the list with the same rank (matchmaking keeps games
//     within a similar rank), so the pool keeps growing.
//
// Riot counts rate limits per region, so each region (europe, asia, americas) gets its own loop:
// collecting from TR + EUW + KR + NA is about three times faster than from Europe alone.
// It only uses the share of the Riot rate limit that people in calls aren't using.
import { db } from '../db.js';
import { staticData } from './ddragon.js';
import { extractBuilds, isUsableGame, patchOfGameVersion, type Match, type Timeline } from './extract.js';
import { LOL_TIERS, type LolTier } from '../protocol.js';
import { regionOf, RiotError, type RiotClient } from './riot.js';
import { addBuilds, comparePatch, gamesPerPatch, prunePatches } from './stats.js';

db.exec(`
  CREATE TABLE IF NOT EXISTS lol_players (
    puuid TEXT PRIMARY KEY, platform TEXT NOT NULL, tier TEXT NOT NULL, next_fetch INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS lol_players_next ON lol_players (next_fetch);
  CREATE TABLE IF NOT EXISTS lol_seen (id TEXT PRIMARY KEY, at INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS lol_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`);

const HOUR = 60 * 60 * 1000;
/** Players kept per rank bracket (seeded and met in games). */
const MAX_PLAYERS_PER_TIER = 8_000;
const SEED_EVERY = 6 * HOUR;
const REFETCH_PLAYER_AFTER = 8 * HOUR;
const QUEUE = 'RANKED_SOLO_5x5';
const LADDER = ['challengerleagues', 'grandmasterleagues', 'masterleagues'];
/** Ladder pages below Master: the first page (~200 players) of every division, with the bracket they count for. */
const DIVISIONS: { path: string; tier: LolTier }[] = (['DIAMOND', 'EMERALD', 'PLATINUM', 'GOLD'] as const).flatMap((tier) =>
  ['I', 'II', 'III', 'IV'].map((d) => ({ path: `${tier}/${d}`, tier })),
);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const getMeta = (key: string) => (db.prepare('SELECT value FROM lol_meta WHERE key = ?').get(key) as { value: string } | undefined)?.value;
const setMeta = (key: string, value: string) =>
  db.prepare('INSERT INTO lol_meta (key, value) VALUES (?, ?) ON CONFLICT DO UPDATE SET value = excluded.value').run(key, value);

const addPlayer = db.prepare('INSERT OR IGNORE INTO lol_players (puuid, platform, tier, next_fetch) VALUES (?, ?, ?, ?)');
const nextPlayerQueries = new Map<string, ReturnType<typeof db.prepare>>();
/** The player of this rank whose games are due first, among these servers. */
function nextPlayer(platforms: string[], tier: LolTier, now: number) {
  const key = platforms.join(',');
  let q = nextPlayerQueries.get(key);
  if (!q) {
    q = db.prepare(
      `SELECT puuid, platform FROM lol_players WHERE next_fetch <= ? AND tier = ? AND platform IN (${platforms.map(() => '?').join(',')}) ORDER BY next_fetch LIMIT 1`,
    );
    nextPlayerQueries.set(key, q);
  }
  return q.get(now, tier, ...platforms) as { puuid: string; platform: string } | undefined;
}
const setNextFetch = db.prepare('UPDATE lol_players SET next_fetch = ? WHERE puuid = ?');
const isSeen = db.prepare('SELECT 1 FROM lol_seen WHERE id = ?');
const markSeen = db.prepare('INSERT OR IGNORE INTO lol_seen (id, at) VALUES (?, ?)');
const playerCount = db.prepare('SELECT COUNT(*) AS n FROM lol_players');
const tierCount = db.prepare('SELECT COUNT(*) AS n FROM lol_players WHERE tier = ?');

export interface CollectorStatus {
  running: boolean;
  matchesAdded: number;
  players: number;
  lastError: string | null;
}

export class Collector {
  private stopped = false;
  private added = 0;
  private lastError: string | null = null;

  constructor(
    private riot: RiotClient,
    private platforms: string[],
    private log: (msg: string, err?: unknown) => void,
    private now = () => Date.now(),
  ) {}

  status(): CollectorStatus {
    return {
      running: !this.stopped,
      matchesAdded: this.added,
      players: (playerCount.get() as { n: number }).n,
      lastError: this.lastError,
    };
  }

  stop() {
    this.stopped = true;
  }

  async run() {
    this.log(`LoL stats collector started (${this.platforms.join(', ')})`);
    const byRegion = new Map<string, string[]>();
    for (const p of this.platforms) byRegion.set(regionOf(p), [...(byRegion.get(regionOf(p)) ?? []), p]);
    await Promise.all([...byRegion.values()].map((platforms) => this.loop(platforms)));
  }

  /** One region's servers, one player at a time. */
  private async loop(platforms: string[]) {
    while (!this.stopped) {
      try {
        const data = staticData();
        if (!data) {
          await sleep(15_000);
          continue;
        }
        await this.seedIfDue(platforms);
        const worked = await this.step(data.patch, platforms);
        if (!worked) await sleep(60_000);
        this.lastError = null;
      } catch (err) {
        this.lastError = (err as Error).message;
        if (err instanceof RiotError && (err.status === 401 || err.status === 403)) {
          this.log('Riot API key rejected (expired or invalid) - collector pauses for 30 minutes', err);
          await sleep(30 * 60_000);
        } else {
          this.log('LoL collector error', err);
          await sleep(15_000);
        }
      }
    }
  }

  /** Refresh the starting list of high-elo players now and then. */
  async seedIfDue(platforms = this.platforms) {
    for (const platform of platforms) {
      const key = `seeded:${platform}`;
      if (this.now() - Number(getMeta(key) ?? 0) < SEED_EVERY) continue;
      try {
        let found = 0;
        for (const league of LADDER) {
          const list = await this.riot.get<{ entries?: { puuid?: string }[] }>(platform, `/lol/league/v4/${league}/by-queue/${QUEUE}`, 'background');
          found += this.addPlayers(platform, 'MASTER', list?.entries);
        }
        for (const division of DIVISIONS) {
          const entries = await this.riot.get<{ puuid?: string }[]>(
            platform,
            `/lol/league/v4/entries/${QUEUE}/${division.path}?page=1`,
            'background',
          );
          found += this.addPlayers(platform, division.tier, entries);
        }
        setMeta(key, String(this.now()));
        this.log(`LoL collector: ${found} new players from ${platform}`);
      } catch (err) {
        if (err instanceof RiotError && (err.status === 401 || err.status === 403)) throw err;
        // One server failing shouldn't stop the others: try this one again in half an hour.
        setMeta(key, String(this.now() - SEED_EVERY + HOUR / 2));
        this.log(`LoL collector: could not read the ${platform} ladder`, err);
      }
    }
  }

  private addPlayers(platform: string, tier: LolTier, entries: { puuid?: string }[] | undefined) {
    let n = 0;
    if (!Array.isArray(entries)) return 0;
    for (const e of entries) if (e.puuid && addPlayer.run(e.puuid, platform, tier, 0).changes) n++;
    return n;
  }

  /** Process one player's recent games. Returns false when nobody is due. */
  /** Per region loop: which rank bracket's turn it is. */
  private turn = new Map<string, number>();

  async step(patch: string, platforms = this.platforms): Promise<boolean> {
    // Take turns between ranks, so Gold+ fills as fast as Master+.
    const loop = platforms.join(',');
    const start = this.turn.get(loop) ?? 0;
    let player: { puuid: string; platform: string } | undefined;
    let tier: LolTier = LOL_TIERS[0];
    for (let i = 0; i < LOL_TIERS.length && !player; i++) {
      tier = LOL_TIERS[(start + i) % LOL_TIERS.length]!;
      player = nextPlayer(platforms, tier, this.now());
      if (player) this.turn.set(loop, (start + i + 1) % LOL_TIERS.length);
    }
    if (!player) return false;
    setNextFetch.run(this.now() + REFETCH_PLAYER_AFTER, player.puuid);

    const region = regionOf(player.platform);
    const ids = await this.riot.get<string[]>(
      region,
      `/lol/match/v5/matches/by-puuid/${encodeURIComponent(player.puuid)}/ids?queue=420&type=ranked&start=0&count=10`,
      'background',
    );
    for (const id of ids) {
      if (this.stopped) break;
      if (isSeen.get(id)) continue;
      // Only games from our servers (the region also contains others, e.g. EUNE).
      if (!this.platforms.includes(id.split('_')[0]!.toLowerCase())) {
        markSeen.run(id, this.now());
        continue;
      }
      const match = await this.riot.get<Match>(region, `/lol/match/v5/matches/${id}`, 'background');
      markSeen.run(id, this.now());
      const gamePatch = patchOfGameVersion(match.info.gameVersion);
      if (comparePatch(gamePatch, patch) < 0) break; // newest first: the rest is older still
      if (!isUsableGame(match)) continue;
      const timeline = await this.riot.get<Timeline>(region, `/lol/match/v5/matches/${id}/timeline`, 'background');
      const data = staticData();
      if (!data) return true;
      addBuilds(gamePatch, tier, extractBuilds(match, timeline, data.items));
      this.added++;
      // Meet new players of the same elo through this game.
      if ((tierCount.get(tier) as { n: number }).n < MAX_PLAYERS_PER_TIER)
        for (const p of match.info.participants) addPlayer.run(p.puuid, player.platform, tier, this.now() + HOUR);
    }
    this.housekeeping();
    return true;
  }

  private lastHousekeeping = 0;
  private housekeeping() {
    if (this.now() - this.lastHousekeeping < HOUR) return;
    this.lastHousekeeping = this.now();
    const patches = gamesPerPatch().map((p) => p.patch);
    if (patches.length > 2) prunePatches(patches.slice(0, 2));
    db.prepare('DELETE FROM lol_seen WHERE at < ?').run(this.now() - 30 * 24 * HOUR);
  }
}
