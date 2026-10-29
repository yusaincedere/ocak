// Turns the aggregated stats into one compact recommendation per champion and role.
import type { LolBuild, LolCounter, LolLang, LolRole, LolRunePage, LolTier, LolVariant } from '../protocol.js';
import type { ChampionInfo, Locale, StaticData } from './ddragon.js';
import { parseRuneKey } from './extract.js';
import { comparePatch, gamesPerPatch, matchupsOf, optionsOf, pickBest, rolesOf, type ChampRole, type Option } from './stats.js';

/** Below this many games on the newest patch, the previous patch is used if it has more. */
const MIN_GAMES = 60;
/** A matchup needs a few games before it's shown at all. */
const MIN_MATCHUP_GAMES = 5;
/**
 * How many imaginary "average" games each matchup starts with. Real matchups sit between ~40% and
 * ~60%, so 3 wins out of 3 says almost nothing: shown as ~55%, not 100%. With hundreds of games
 * the real numbers take over.
 */
const MATCHUP_PRIOR_GAMES = 30;
const MAX_VARIANTS = 3;
/** A build seen in fewer games than this is noise ("100% win rate" from two games). */
const MIN_VARIANT_GAMES = 5;
/** …and at least this share of the champion's games in that role. */
const VARIANT_MIN_SHARE = 0.04;
/** Imaginary average games a variant's win rate starts from (see MATCHUP_PRIOR_GAMES). */
const VARIANT_PRIOR_GAMES = 20;

const locale = (lang: LolLang): Locale => (lang === 'tr' ? 'tr_TR' : 'en_US');
const rate = (wins: number, games: number) => (games ? Math.round((wins / games) * 1000) / 10 : 0);

export function findChampion(data: StaticData, raw: string): ChampionInfo | null {
  const key = Number(raw);
  if (Number.isInteger(key) && data.champions.has(key)) return data.champions.get(key)!;
  return data.championsById.get(raw.toLowerCase()) ?? null;
}

/** The patch to read for this champion: newest with enough games, else whichever has more. */
function patchFor(champ: number, tiers: readonly LolTier[]): { patch: string; roles: ChampRole[] } | null {
  const patches = gamesPerPatch(tiers)
    .map((p) => p.patch)
    .sort((a, b) => comparePatch(b, a))
    .slice(0, 2);
  let best: { patch: string; roles: ChampRole[]; games: number } | null = null;
  for (const patch of patches) {
    const roles = rolesOf(patch, champ, tiers);
    const games = roles.reduce((s, r) => s + r.games, 0);
    if (games >= MIN_GAMES) return { patch, roles };
    if (!best || games > best.games) best = { patch, roles, games };
  }
  return best && best.games > 0 ? best : null;
}

export function buildFor(
  data: StaticData,
  champ: ChampionInfo,
  wantedRole: string | undefined,
  lang: LolLang,
  tiers: readonly LolTier[],
): LolBuild | null {
  const found = patchFor(champ.key, tiers);
  if (!found) return null;
  const { patch, roles } = found;
  const total = roles.reduce((s, r) => s + r.games, 0);
  // Roles played in under 5% of this champion's games are noise (off-meta picks, swaps).
  const realRoles = roles.filter((r) => r.games >= Math.max(5, total * 0.05));
  const roleRow = realRoles.find((r) => r.role === wantedRole) ?? realRoles[0] ?? roles[0]!;
  const role = roleRow.role;
  const loc = locale(lang);

  const best = (kind: Parameters<typeof optionsOf>[3]) => pickBest(optionsOf(patch, champ.key, role, kind, tiers))?.value ?? null;
  const items = (csv: string | null) =>
    csv
      ? csv
          .split(',')
          .map(Number)
          .map((id) => ({ id, name: data.items.get(id)?.name[loc] ?? String(id) }))
      : null;
  const rune = (id: number) => {
    const r = data.runes.get(id);
    return { id, name: r?.name[loc] ?? String(id), icon: r?.icon ?? '' };
  };

  const order = best('skillOrder');
  const spellsCsv = best('spells');
  const bootsCsv = best('boots');

  const runePage = (key: string | null): LolRunePage | null => {
    const r = key ? parseRuneKey(key) : null;
    return r
      ? {
          primary: rune(r.primaryStyle),
          keystone: rune(r.primary[0]!),
          primaryRunes: r.primary.slice(1).map(rune),
          secondary: rune(r.subStyle),
          secondaryRunes: r.sub.map(rune),
          shards: r.shards,
        }
      : null;
  };
  const variants = variantsOf(patch, champ.key, role, roleRow, tiers).map(
    (v): LolVariant => ({ ...v, core: items(v.core), runes: runePage(v.runes) }),
  );
  const main = variants[0];

  return {
    champion: { id: champ.id, key: champ.key, name: champ.name[loc] },
    patch,
    role,
    roles: realRoles.map((r) => ({ role: r.role, games: r.games, winRate: rate(r.wins, r.games) })),
    games: roleRow.games,
    winRate: rate(roleRow.wins, roleRow.games),
    skills: order ? { order, first: best('firstSkills') } : null,
    abilities: null, // filled in by the route (needs a Data Dragon request)
    start: items(best('start')),
    core: main?.core ?? null,
    boots: items(bootsCsv)?.[0] ?? null,
    runes: main?.runes ?? null,
    spells: spellsCsv
      ? spellsCsv
          .split(',')
          .map(Number)
          // Flash on the right like most players (D/F), whatever the order in the data.
          .sort((a, b) => (a === 4 ? 1 : b === 4 ? -1 : a - b))
          .map((key) => {
            const s = data.spells.get(key);
            return { id: key, name: s?.name[loc] ?? String(key), image: s?.image ?? '' };
          })
      : null,
    variants,
    counters: counters(data, champ.key, role, loc, roleRow, tiers),
  };
}

/**
 * Build variants, the recommended one first:
 *  1. different keystone + first item (Electrocute + Luden's vs Comet + Rabadon's), then
 *  2. if there's room, other common item paths of the main build (only the third item differs).
 * Each needs a few games and a small share of the champion's games; win rates are smoothed like
 * matchups, so ten games can't claim 20% or 90%.
 */
function variantsOf(patch: string, champ: number, role: LolRole, overall: { games: number; wins: number }, tiers: readonly LolTier[]) {
  const coreOpts = optionsOf(patch, champ, role, 'core', tiers);
  const runeOpts = optionsOf(patch, champ, role, 'runes', tiers);
  const groups = optionsOf(patch, champ, role, 'variant', tiers);
  const enough = (o: Option) => o.games >= Math.max(MIN_VARIANT_GAMES, overall.games * VARIANT_MIN_SHARE);
  const base = Math.min(0.54, Math.max(0.46, overall.games ? overall.wins / overall.games : 0.5));
  const out: { games: number; winRate: number; pickRate: number; core: string | null; runes: string | null }[] = [];
  const add = (stats: Option[], core: string | null, runes: string | null) => {
    if (out.some((v) => v.core === core && v.runes === runes)) return;
    const g = stats.reduce((n, o) => n + o.games, 0);
    const w = stats.reduce((n, o) => n + o.wins, 0);
    out.push({
      games: g,
      winRate: Math.round(((w + base * VARIANT_PRIOR_GAMES) / (g + VARIANT_PRIOR_GAMES)) * 1000) / 10,
      pickRate: overall.games ? Math.round((g / overall.games) * 100) : 0,
      core,
      runes,
    });
  };
  const bestCore = (first: string | undefined) => pickBest(first ? coreOpts.filter((o) => o.value.split(',')[0] === first) : coreOpts);
  const bestRunes = (keystone: string | undefined) =>
    pickBest(keystone ? runeOpts.filter((o) => String(parseRuneKey(o.value)?.primary[0]) === keystone) : runeOpts)?.value ?? null;

  // Every variant, the recommended one too, needs enough games behind it.
  const recommended = pickBest(groups.filter(enough));
  if (!recommended) {
    // Too little variant data (few games, or collected before variants were tracked): one build from everything.
    if (coreOpts.length || runeOpts.length) add(coreOpts.length ? coreOpts : runeOpts, pickBest(coreOpts)?.value ?? null, pickBest(runeOpts)?.value ?? null);
    return out;
  }

  // 1. different keystone / first item
  const [mainKeystone, mainFirst] = recommended.value.split(':');
  for (const g of [recommended, ...groups.filter((g) => g !== recommended && enough(g)).sort((a, b) => b.games - a.games)]) {
    if (out.length >= MAX_VARIANTS) break;
    const [keystone, first] = g.value.split(':');
    add([g], bestCore(first)?.value ?? null, bestRunes(keystone));
  }
  // 2. other item paths of the main build
  const mainRunes = bestRunes(mainKeystone);
  const paths = coreOpts.filter((o) => o.value.split(',')[0] === mainFirst && enough(o)).sort((a, b) => b.games - a.games);
  for (const path of paths) {
    if (out.length >= MAX_VARIANTS) break;
    add([path], path.value, mainRunes);
  }
  return out;
}

/** A matchup's win rate (0-1) estimated from few games: `base` plus what the games show beyond it. */
export const matchupWinRate = (wins: number, games: number, base = 0.5) =>
  (wins + base * MATCHUP_PRIOR_GAMES) / (games + MATCHUP_PRIOR_GAMES);

function counters(
  data: StaticData,
  champ: number,
  role: LolRole,
  loc: Locale,
  overall: { games: number; wins: number },
  tiers: readonly LolTier[],
) {
  // Matchups change less from patch to patch than builds do: use the two newest patches together.
  const patches = gamesPerPatch(tiers).slice(0, 2).map((p) => p.patch);
  const merged = new Map<number, { games: number; wins: number }>();
  for (const patch of patches)
    for (const m of matchupsOf(patch, champ, role, tiers)) {
      const e = merged.get(m.opp) ?? { games: 0, wins: 0 };
      e.games += m.games;
      e.wins += m.wins;
      merged.set(m.opp, e);
    }
  // Start every matchup from this champion's usual win rate (kept near 50%), then let the games move it.
  const base = Math.min(0.54, Math.max(0.46, overall.games ? overall.wins / overall.games : 0.5));
  const estimate = (m: { games: number; wins: number }) => matchupWinRate(m.wins, m.games, base);
  const rows = [...merged]
    .filter(([opp, m]) => m.games >= MIN_MATCHUP_GAMES && data.champions.has(opp))
    .map(([opp, m]) => {
      const c = data.champions.get(opp)!;
      const est = estimate(m);
      const counter: LolCounter = { champion: { id: c.id, key: c.key, name: c.name[loc] }, games: m.games, winRate: Math.round(est * 1000) / 10 };
      return { counter, delta: est - base };
    });
  // Hard / easy compared with how this champion usually does, at least a point either way.
  return {
    hard: rows.filter((r) => r.delta <= -0.01).sort((a, b) => a.delta - b.delta).slice(0, 5).map((r) => r.counter),
    easy: rows.filter((r) => r.delta >= 0.01).sort((a, b) => b.delta - a.delta).slice(0, 5).map((r) => r.counter),
  };
}
