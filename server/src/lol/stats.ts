// Build and counter statistics, aggregated per patch, rank bracket, champion and role in SQLite.
// Queries add up a range of brackets ("Platinum+" = Platinum, Emerald, Diamond and Master).
import { db } from '../db.js';
import { LOL_TIERS, type LolTier } from '../protocol.js';
import type { BuildRecord, Role } from './extract.js';

// Stats from before rank brackets were tracked can't be split by rank: start over once
// (the collector fills them again; seen matches and players are reset so it re-reads them).
// Every table is checked, so a half-finished upgrade is cleaned up too.
const columnsOf = (table: string) => (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);
const oldStats = ['lol_champ', 'lol_option', 'lol_matchup', 'lol_players'].some((t) => {
  const cols = columnsOf(t);
  return cols.length > 0 && !cols.includes('tier');
});
if (oldStats)
  db.exec(`
    DROP TABLE IF EXISTS lol_champ; DROP TABLE IF EXISTS lol_option; DROP TABLE IF EXISTS lol_matchup;
    DROP TABLE IF EXISTS lol_players; DROP TABLE IF EXISTS lol_seen; DROP TABLE IF EXISTS lol_meta;
  `);

db.exec(`
  CREATE TABLE IF NOT EXISTS lol_champ (
    patch TEXT NOT NULL, tier TEXT NOT NULL, champ INTEGER NOT NULL, role TEXT NOT NULL,
    games INTEGER NOT NULL, wins INTEGER NOT NULL,
    PRIMARY KEY (patch, champ, role, tier)
  );
  CREATE TABLE IF NOT EXISTS lol_option (
    patch TEXT NOT NULL, tier TEXT NOT NULL, champ INTEGER NOT NULL, role TEXT NOT NULL,
    kind TEXT NOT NULL, value TEXT NOT NULL,
    games INTEGER NOT NULL, wins INTEGER NOT NULL,
    PRIMARY KEY (patch, champ, role, kind, value, tier)
  );
  CREATE TABLE IF NOT EXISTS lol_matchup (
    patch TEXT NOT NULL, tier TEXT NOT NULL, champ INTEGER NOT NULL, role TEXT NOT NULL, opp INTEGER NOT NULL,
    games INTEGER NOT NULL, wins INTEGER NOT NULL,
    PRIMARY KEY (patch, champ, role, opp, tier)
  );
`);

export const OPTION_KINDS = ['skillOrder', 'firstSkills', 'start', 'core', 'boots', 'runes', 'spells', 'variant'] as const;
export type OptionKind = (typeof OPTION_KINDS)[number];

const upChamp = db.prepare(`
  INSERT INTO lol_champ (patch, tier, champ, role, games, wins) VALUES (?, ?, ?, ?, 1, ?)
  ON CONFLICT DO UPDATE SET games = games + 1, wins = wins + excluded.wins`);
const upOption = db.prepare(`
  INSERT INTO lol_option (patch, tier, champ, role, kind, value, games, wins) VALUES (?, ?, ?, ?, ?, ?, 1, ?)
  ON CONFLICT DO UPDATE SET games = games + 1, wins = wins + excluded.wins`);
const upMatchup = db.prepare(`
  INSERT INTO lol_matchup (patch, tier, champ, role, opp, games, wins) VALUES (?, ?, ?, ?, ?, 1, ?)
  ON CONFLICT DO UPDATE SET games = games + 1, wins = wins + excluded.wins`);

export function addBuilds(patch: string, tier: LolTier, records: BuildRecord[]) {
  db.exec('BEGIN');
  try {
    for (const r of records) {
      const w = r.win ? 1 : 0;
      upChamp.run(patch, tier, r.champion, r.role, w);
      for (const kind of OPTION_KINDS) {
        const value = r[kind];
        if (value) upOption.run(patch, tier, r.champion, r.role, kind, value, w);
      }
      if (r.opponent) upMatchup.run(patch, tier, r.champion, r.role, r.opponent, w);
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

/** Keep only the newest `keep` patches. */
export function prunePatches(keep: string[]) {
  const marks = keep.map(() => '?').join(',');
  for (const t of ['lol_champ', 'lol_option', 'lol_matchup']) db.prepare(`DELETE FROM ${t} WHERE patch NOT IN (${marks})`).run(...keep);
}

/** Prepared statements for a query with an `IN (…)` list of tiers, cached per list length. */
const cache = new Map<string, ReturnType<typeof db.prepare>>();
function query(sql: (tierMarks: string) => string, tiers: readonly LolTier[]) {
  const key = `${tiers.length}:${sql('#')}`;
  let q = cache.get(key);
  if (!q) cache.set(key, (q = db.prepare(sql(tiers.map(() => '?').join(',')))));
  return q;
}

export interface Option {
  value: string;
  games: number;
  wins: number;
}

/** Lower bound of the win rate's confidence interval: rewards both win rate and sample size. */
export function wilson(wins: number, games: number, z = 1.0) {
  if (!games) return 0;
  const p = wins / games;
  const d = 1 + (z * z) / games;
  const centre = p + (z * z) / (2 * games);
  const margin = z * Math.sqrt((p * (1 - p)) / games + (z * z) / (4 * games * games));
  return (centre - margin) / d;
}

/**
 * The option to recommend: among reasonably popular choices (≥ minShare of the most picked one),
 * the one whose win rate holds up best given its sample size.
 */
export function pickBest(options: Option[], minShare = 0.25): Option | null {
  if (!options.length) return null;
  const top = Math.max(...options.map((o) => o.games));
  const popular = options.filter((o) => o.games >= top * minShare);
  return popular.reduce((best, o) => (wilson(o.wins, o.games) > wilson(best.wins, best.games) ? o : best));
}

export interface ChampRole {
  role: Role;
  games: number;
  wins: number;
}

export function rolesOf(patch: string, champ: number, tiers: readonly LolTier[]): ChampRole[] {
  return query(
    (t) => `SELECT role, SUM(games) AS games, SUM(wins) AS wins FROM lol_champ
            WHERE patch = ? AND champ = ? AND tier IN (${t}) GROUP BY role ORDER BY games DESC`,
    tiers,
  ).all(patch, champ, ...tiers) as unknown as ChampRole[];
}

export function optionsOf(patch: string, champ: number, role: string, kind: OptionKind, tiers: readonly LolTier[]): Option[] {
  return query(
    (t) => `SELECT value, SUM(games) AS games, SUM(wins) AS wins FROM lol_option
            WHERE patch = ? AND champ = ? AND role = ? AND kind = ? AND tier IN (${t})
            GROUP BY value ORDER BY games DESC LIMIT 40`,
    tiers,
  ).all(patch, champ, role, kind, ...tiers) as unknown as Option[];
}

export interface Matchup {
  opp: number;
  games: number;
  wins: number;
}

export function matchupsOf(patch: string, champ: number, role: string, tiers: readonly LolTier[]): Matchup[] {
  return query(
    (t) => `SELECT opp, SUM(games) AS games, SUM(wins) AS wins FROM lol_matchup
            WHERE patch = ? AND champ = ? AND role = ? AND tier IN (${t}) GROUP BY opp`,
    tiers,
  ).all(patch, champ, role, ...tiers) as unknown as Matchup[];
}

/** Total games per patch in these brackets (to tell which patch has enough data). */
export function gamesPerPatch(tiers: readonly LolTier[] = LOL_TIERS): { patch: string; games: number }[] {
  const rows = query((t) => `SELECT patch, SUM(games) / 10 AS games FROM lol_champ WHERE tier IN (${t}) GROUP BY patch`, tiers).all(
    ...tiers,
  ) as unknown as { patch: string; games: number }[];
  return rows.sort((a, b) => comparePatch(b.patch, a.patch));
}

/** Numeric patch comparison ("15.9" < "15.21"). */
export function comparePatch(a: string, b: string) {
  const [a1 = 0, a2 = 0] = a.split('.').map(Number);
  const [b1 = 0, b2 = 0] = b.split('.').map(Number);
  return a1 - b1 || a2 - b2;
}
