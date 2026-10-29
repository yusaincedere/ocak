// A fake Riot API + Data Dragon for tests and local demos. Shapes follow the real APIs
// (match-v5, timeline, league-v4, account-v1, Data Dragon) but only the fields Ocak reads.
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

export const VERSION = '15.21.1';
export const GAME_VERSION = '15.21.712.1234';

const champ = (id: string, key: number, name = id) => [id, { id, key: String(key), name }] as const;
export const CHAMPIONS = Object.fromEntries([
  champ('Ahri', 103),
  champ('Zed', 238),
  champ('Lux', 99),
  champ('Yasuo', 157),
  champ('Garen', 86),
  champ('Darius', 122),
  champ('LeeSin', 64, 'Lee Sin'),
  champ('Vi', 254),
  champ('Jinx', 222),
  champ('Caitlyn', 51),
  champ('Thresh', 412),
  champ('Leona', 89),
]);

const item = (name: string, total: number, extra: Record<string, unknown> = {}) => ({
  name,
  gold: { total, purchasable: true },
  tags: [],
  maps: { '11': true },
  ...extra,
});
export const ITEMS: Record<string, ReturnType<typeof item>> = {
  '1056': item("Doran's Ring", 400),
  '1055': item("Doran's Blade", 450),
  '1054': item("Doran's Shield", 450),
  '1103': item('Mosstomper Seedling', 450),
  '3850': item('Spellthief\'s Edge', 400),
  '2003': item('Health Potion', 50, { tags: ['Consumable'], consumed: true }),
  '3340': item('Stealth Ward', 0, { tags: ['Trinket', 'Vision'] }),
  '1001': item('Boots', 300, { tags: ['Boots'], into: ['3020', '3006', '3047', '3111'] }),
  '3020': item("Sorcerer's Shoes", 1100, { tags: ['Boots'] }),
  '3006': item("Berserker's Greaves", 1100, { tags: ['Boots'] }),
  '3047': item('Plated Steelcaps', 1200, { tags: ['Boots'] }),
  '3111': item("Mercury's Treads", 1250, { tags: ['Boots'] }),
  '1052': item('Amplifying Tome', 400, { into: ['3802'] }),
  '3802': item('Lost Chapter', 1200, { into: ['6655'] }),
  '6655': item("Luden's Companion", 2850),
  '4645': item('Shadowflame', 3200),
  '3089': item("Rabadon's Deathcap", 3500),
  '3157': item("Zhonya's Hourglass", 3250),
  '3135': item('Void Staff', 3000),
  '3031': item('Infinity Edge', 3450),
  '6672': item('Kraken Slayer', 3100),
  '3036': item("Lord Dominik's Regards", 3100),
  '3071': item('Black Cleaver', 3000),
  '3053': item("Sterak's Gage", 3200),
  '6333': item("Death's Dance", 3300),
  '3190': item('Locket of the Iron Solari', 2200),
  '3050': item("Zeke's Convergence", 2200),
  '6693': item('Profane Hydra', 3200),
};

const style = (id: number, name: string, slots: number[][]) => ({
  id,
  key: name,
  name,
  icon: `perk-images/Styles/${name}.png`,
  slots: slots.map((ids) => ({ runes: ids.map((r) => ({ id: r, key: `R${r}`, name: `Rune ${r}`, icon: `perk-images/Styles/${name}/${r}.png` })) })),
});
export const RUNES = [
  style(8100, 'Domination', [[8112, 8128], [8126, 8139], [8138, 8136], [8135, 8105]]),
  style(8000, 'Precision', [[8010, 8005, 8008], [9111, 8009], [9104, 9105], [8014, 8017]]),
  style(8200, 'Sorcery', [[8214, 8229], [8226, 8275], [8210, 8234], [8237, 8236]]),
  style(8300, 'Inspiration', [[8351, 8360], [8306, 8304], [8345, 8347], [8410, 8352]]),
  style(8400, 'Resolve', [[8437, 8439], [8446, 8463], [8429, 8444], [8451, 8453]]),
];

export const SPELLS = {
  SummonerFlash: { id: 'SummonerFlash', key: '4', name: 'Flash', image: { full: 'SummonerFlash.png' } },
  SummonerDot: { id: 'SummonerDot', key: '14', name: 'Ignite', image: { full: 'SummonerDot.png' } },
  SummonerTeleport: { id: 'SummonerTeleport', key: '12', name: 'Teleport', image: { full: 'SummonerTeleport.png' } },
  SummonerSmite: { id: 'SummonerSmite', key: '11', name: 'Smite', image: { full: 'SummonerSmite.png' } },
  SummonerHeal: { id: 'SummonerHeal', key: '7', name: 'Heal', image: { full: 'SummonerHeal.png' } },
  SummonerExhaust: { id: 'SummonerExhaust', key: '3', name: 'Exhaust', image: { full: 'SummonerExhaust.png' } },
};

/** Data Dragon responses by path. */
export function ddragonFiles(): Record<string, unknown> {
  const files: Record<string, unknown> = { '/api/versions.json': [VERSION, '15.20.1'] };
  for (const locale of ['en_US', 'tr_TR']) {
    const base = `/cdn/${VERSION}/data/${locale}`;
    files[`${base}/champion.json`] = { data: CHAMPIONS };
    files[`${base}/item.json`] = { data: ITEMS };
    files[`${base}/runesReforged.json`] = RUNES;
    files[`${base}/summoner.json`] = { data: SPELLS };
    for (const id of Object.keys(CHAMPIONS))
      files[`${base}/champion/${id}.json`] = {
        data: { [id]: { spells: ['Q', 'W', 'E', 'R'].map((k) => ({ name: `${id} ${k}`, image: { full: `${id}${k}.png` } })) } },
      };
  }
  return files;
}

// ---------- games ----------

type Position = 'TOP' | 'JUNGLE' | 'MIDDLE' | 'BOTTOM' | 'UTILITY';
interface Kit {
  champ: string;
  position: Position;
  skills: number[]; // 18 level-ups, slots 1-4
  start: number[];
  path: number[]; // purchases after the start, in order
  spells: [number, number];
  runes: { primaryStyle: number; primary: number[]; subStyle: number; sub: number[]; shards: [number, number, number] };
}

const maxQ = [1, 3, 2, 1, 1, 4, 1, 2, 1, 2, 4, 2, 2, 3, 3, 4, 3, 3];
const maxQE = [1, 2, 3, 1, 1, 4, 1, 3, 1, 3, 4, 3, 3, 2, 2, 4, 2, 2];
const maxE = [3, 1, 2, 3, 3, 4, 3, 1, 3, 1, 4, 1, 1, 2, 2, 4, 2, 2];
const elec = { primaryStyle: 8100, primary: [8112, 8139, 8138, 8135], subStyle: 8200, sub: [8226, 8210], shards: [5008, 5008, 5011] as [number, number, number] };
const conq = { primaryStyle: 8000, primary: [8010, 9111, 9104, 8014], subStyle: 8400, sub: [8444, 8429], shards: [5005, 5008, 5011] as [number, number, number] };
const pta = { primaryStyle: 8000, primary: [8005, 9111, 9104, 8014], subStyle: 8300, sub: [8345, 8304], shards: [5005, 5008, 5011] as [number, number, number] };
const aery = { primaryStyle: 8200, primary: [8214, 8226, 8210, 8237], subStyle: 8300, sub: [8345, 8304], shards: [5008, 5008, 5011] as [number, number, number] };
const guard = { primaryStyle: 8400, primary: [8439, 8463, 8429, 8451], subStyle: 8300, sub: [8345, 8347], shards: [5007, 5008, 5011] as [number, number, number] };

export const KITS: Record<string, Kit[]> = {
  MIDDLE: [
    { champ: 'Ahri', position: 'MIDDLE', skills: maxQ, start: [1056, 2003, 2003], path: [1052, 3802, 6655, 3020, 4645, 3089, 3157], spells: [14, 4], runes: elec },
    { champ: 'Zed', position: 'MIDDLE', skills: maxQE, start: [1055, 2003], path: [6693, 3047, 3071, 6333, 3036], spells: [4, 14], runes: elec },
    { champ: 'Lux', position: 'MIDDLE', skills: maxE, start: [1056, 2003, 2003], path: [6655, 3020, 4645, 3089], spells: [4, 12], runes: aery },
    { champ: 'Yasuo', position: 'MIDDLE', skills: maxQE, start: [1055, 2003], path: [3031, 3006, 6672, 3036], spells: [4, 12], runes: conq },
  ],
  TOP: [
    { champ: 'Garen', position: 'TOP', skills: maxQE, start: [1055, 2003], path: [3071, 3047, 3053, 6333], spells: [4, 14], runes: conq },
    { champ: 'Darius', position: 'TOP', skills: maxQ, start: [1055, 2003], path: [3071, 3047, 3053, 6333], spells: [4, 12], runes: conq },
  ],
  JUNGLE: [
    { champ: 'LeeSin', position: 'JUNGLE', skills: maxQ, start: [1103], path: [6693, 3047, 3071, 6333], spells: [4, 11], runes: conq },
    { champ: 'Vi', position: 'JUNGLE', skills: maxQ, start: [1103], path: [3071, 3047, 3053, 6333], spells: [4, 11], runes: conq },
  ],
  BOTTOM: [
    { champ: 'Jinx', position: 'BOTTOM', skills: maxQ, start: [1055, 2003], path: [6672, 3006, 3031, 3036], spells: [4, 7], runes: pta },
    { champ: 'Caitlyn', position: 'BOTTOM', skills: maxQ, start: [1055, 2003], path: [3031, 3006, 6672, 3036], spells: [4, 7], runes: pta },
  ],
  UTILITY: [
    { champ: 'Thresh', position: 'UTILITY', skills: maxQE, start: [3850, 2003], path: [3190, 3111, 3050], spells: [4, 3], runes: guard },
    { champ: 'Leona', position: 'UTILITY', skills: maxE, start: [3850, 2003], path: [3190, 3047, 3050], spells: [4, 3], runes: guard },
  ],
};

/** Deterministic pseudo-random numbers so test data is stable. */
export function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

export interface FakeGame {
  match: unknown;
  timeline: unknown;
}

/**
 * One 10-player ranked game. Built-in matchup bias for tests: Zed beats Ahri, Ahri beats Lux;
 * every 4th Ahri goes Rabadon's first (a second build variant).
 */
export function makeGame(id: string, seed: number, players: { puuid: string; gameName: string; tagLine: string }[], forceMid?: [string, string]) {
  const rand = rng(seed);
  const positions: Position[] = ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY'];
  const pick = (pos: Position, avoid?: string, prefer?: string) => {
    const list = KITS[pos]!.filter((k) => k.champ !== avoid);
    return (prefer && list.find((k) => k.champ === prefer)) || list[Math.floor(rand() * list.length)]!;
  };
  const kits: Kit[] = [];
  for (const pos of positions) kits.push(pick(pos, undefined, pos === 'MIDDLE' ? forceMid?.[0] : undefined));
  for (const pos of positions) kits.push(pick(pos, kits.find((k) => k.position === pos)!.champ, pos === 'MIDDLE' ? forceMid?.[1] : undefined));

  const mid = (team: 0 | 1) => kits[team * 5 + 2]!.champ;
  const blueWinChance = (() => {
    const [a, b] = [mid(0), mid(1)];
    if (a === 'Zed' && b === 'Ahri') return 0.75;
    if (a === 'Ahri' && b === 'Zed') return 0.25;
    if (a === 'Ahri' && b === 'Lux') return 0.72;
    if (a === 'Lux' && b === 'Ahri') return 0.28;
    return 0.5;
  })();
  const blueWins = rand() < blueWinChance;
  const duration = 1500 + Math.floor(rand() * 900);

  const participants = kits.map((k, i) => {
    const pid = i + 1;
    const team = i < 5 ? 100 : 200;
    const win = team === 100 ? blueWins : !blueWins;
    const who = players[i]!;
    const kills = Math.floor(rand() * (win ? 12 : 7));
    const deaths = Math.floor(rand() * (win ? 6 : 10));
    const items = k.path.filter((it) => (ITEMS[String(it)]?.gold.total ?? 0) >= 1000).slice(0, 6);
    return {
      participantId: pid,
      puuid: who.puuid,
      riotIdGameName: who.gameName,
      riotIdTagline: who.tagLine,
      championId: Number(CHAMPIONS[k.champ]!.key),
      championName: k.champ,
      teamId: team,
      teamPosition: k.position,
      win,
      kills,
      deaths,
      assists: Math.floor(rand() * 14),
      totalDamageDealtToChampions: 8000 + Math.floor(rand() * 30000),
      totalDamageTaken: 10000 + Math.floor(rand() * 25000),
      damageSelfMitigated: Math.floor(rand() * 20000),
      totalHealsOnTeammates: k.position === 'UTILITY' ? Math.floor(rand() * 6000) : 0,
      goldEarned: 8000 + Math.floor(rand() * 9000),
      totalMinionsKilled: k.position === 'UTILITY' || k.position === 'JUNGLE' ? 30 + Math.floor(rand() * 40) : 150 + Math.floor(rand() * 120),
      neutralMinionsKilled: k.position === 'JUNGLE' ? 120 + Math.floor(rand() * 60) : 0,
      visionScore: k.position === 'UTILITY' ? 50 + Math.floor(rand() * 40) : 10 + Math.floor(rand() * 25),
      timeCCingOthers: Math.floor(rand() * 40),
      champLevel: 13 + Math.floor(rand() * 5),
      largestMultiKill: rand() < 0.03 ? 5 : 1 + Math.floor(rand() * 3),
      pentaKills: 0,
      quadraKills: 0,
      item0: items[0] ?? 0,
      item1: items[1] ?? 0,
      item2: items[2] ?? 0,
      item3: items[3] ?? 0,
      item4: items[4] ?? 0,
      item5: items[5] ?? 0,
      item6: 3340,
      summoner1Id: k.spells[0],
      summoner2Id: k.spells[1],
      perks: {
        statPerks: { offense: k.runes.shards[0], flex: k.runes.shards[1], defense: k.runes.shards[2] },
        styles: [
          { description: 'primaryStyle', style: k.runes.primaryStyle, selections: k.runes.primary.map((perk) => ({ perk })) },
          { description: 'subStyle', style: k.runes.subStyle, selections: k.runes.sub.map((perk) => ({ perk })) },
        ],
      },
      challenges: { killParticipation: 0.3 + rand() * 0.5, soloKills: Math.floor(rand() * 4), skillshotsDodged: Math.floor(rand() * 60) },
    };
  });
  for (const p of participants) if (p.largestMultiKill === 5) p.pentaKills = 1;

  // Timeline: starting items at ~0:15, then the item path spread over the game, skills by level.
  const events: { type: string; participantId: number; timestamp: number; itemId?: number; skillSlot?: number; beforeId?: number }[] = [];
  kits.forEach((k, i) => {
    const pid = i + 1;
    let t = 15_000;
    for (const it of k.start) events.push({ type: 'ITEM_PURCHASED', participantId: pid, itemId: it, timestamp: (t += 500) });
    // a quick buy-and-undo, which must not count
    events.push({ type: 'ITEM_PURCHASED', participantId: pid, itemId: 2003, timestamp: (t += 500) });
    events.push({ type: 'ITEM_UNDO', participantId: pid, beforeId: 2003, timestamp: (t += 500) });
    let path = k.path;
    if (k.champ === 'Ahri' && seed % 4 === 0) path = [3089, 6655, 3020, 4645, 3157]; // the less common build: Rabadon's first
    path.forEach((it, j) => events.push({ type: 'ITEM_PURCHASED', participantId: pid, itemId: it, timestamp: 300_000 + j * 240_000 }));
    k.skills.forEach((slot, lvl) => events.push({ type: 'SKILL_LEVEL_UP', participantId: pid, skillSlot: slot, timestamp: 10_000 + lvl * 90_000 }));
  });
  events.sort((a, b) => a.timestamp - b.timestamp);
  const frames: { events: typeof events }[] = [];
  for (let m = 0; m <= Math.ceil(duration / 60); m++)
    frames.push({ events: events.filter((e) => e.timestamp >= m * 60_000 && e.timestamp < (m + 1) * 60_000) });

  return {
    match: {
      metadata: { matchId: id },
      info: {
        gameVersion: GAME_VERSION,
        queueId: 420,
        gameDuration: duration,
        gameCreation: 1_760_000_000_000 + seed * 3_600_000,
        gameEndTimestamp: 1_760_000_000_000 + seed * 3_600_000 + duration * 1000,
        participants,
      },
    },
    timeline: { info: { frames } },
  } satisfies FakeGame;
}

/**
 * A fake Riot API + Data Dragon on localhost. `games` games among `playerCount` players;
 * player 0 is also reachable by Riot ID "Yusa#TR1".
 */
export async function startFakeRiot({ games = 300, playerCount = 40, rateHeader = '500:1,50000:120' } = {}) {
  const players = Array.from({ length: playerCount }, (_, i) => ({
    puuid: `puuid-${String(i).padStart(4, '0')}-${'x'.repeat(40)}`,
    gameName: i === 0 ? 'Yusa' : i === 1 ? 'Mert' : `Player${i}`,
    tagLine: 'TR1',
  }));
  const rand = rng(7);
  const store = new Map<string, FakeGame>();
  const byPlayer = new Map<string, string[]>();
  for (let g = 0; g < games; g++) {
    const id = `TR1_${7_000_000_000 + g}`;
    const ten = [...players].sort(() => rand() - 0.5).slice(0, 10);
    // Plenty of mid-lane Ahri games so the build has data.
    const force: [string, string] | undefined = g % 3 === 0 ? ['Ahri', g % 2 ? 'Zed' : 'Lux'] : g % 3 === 1 ? ['Zed', 'Ahri'] : undefined;
    const game = makeGame(id, g + 1, ten, force);
    store.set(id, game);
    for (const p of ten) byPlayer.set(p.puuid, [id, ...(byPlayer.get(p.puuid) ?? [])]);
  }
  const dd = ddragonFiles();
  const hits: Record<string, number> = {};

  const server: Server = createServer((req, res) => {
    const url = new URL(req.url!, 'http://x');
    const path = url.pathname;
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json', 'x-app-rate-limit': rateHeader });
      res.end(JSON.stringify(body));
    };
    const kind = path.replace(/\/(TR1_\d+|puuid-[^/]+)/g, '/:x');
    hits[kind] = (hits[kind] ?? 0) + 1;

    if (path.startsWith('/ddragon')) {
      const file = dd[path.slice('/ddragon'.length)];
      return file ? send(200, file) : send(404, {});
    }
    if (req.headers['x-riot-token'] !== 'RGAPI-test') return send(401, { status: { status_code: 401 } });

    let m: RegExpMatchArray | null;
    if ((m = path.match(/^\/tr1\/lol\/league\/v4\/(challenger|grandmaster|master)leagues\/by-queue\//)))
      return send(200, { entries: m[1] === 'challenger' ? players.slice(0, 5).map((p) => ({ puuid: p.puuid })) : [] });
    if (path.startsWith('/tr1/lol/league/v4/entries/'))
      return send(200, path.includes('DIAMOND/I') && !path.includes('II') ? players.slice(5, 10).map((p) => ({ puuid: p.puuid })) : []);
    if (path.match(/^\/[a-z0-9]+\/lol\/league\/v4\//)) return send(200, { entries: [] });
    if ((m = path.match(/^\/europe\/lol\/match\/v5\/matches\/by-puuid\/([^/]+)\/ids$/))) {
      const ids = byPlayer.get(decodeURIComponent(m[1]!)) ?? [];
      return send(200, ids.slice(Number(url.searchParams.get('start') ?? 0), Number(url.searchParams.get('count') ?? 20)));
    }
    if ((m = path.match(/^\/europe\/lol\/match\/v5\/matches\/([A-Z0-9_]+)\/timeline$/))) {
      const g = store.get(m[1]!);
      return g ? send(200, g.timeline) : send(404, {});
    }
    if ((m = path.match(/^\/europe\/lol\/match\/v5\/matches\/([A-Z0-9_]+)$/))) {
      const g = store.get(m[1]!);
      return g ? send(200, g.match) : send(404, {});
    }
    if ((m = path.match(/^\/tr1\/lol\/champion-mastery\/v4\/champion-masteries\/by-puuid\/([^/]+)\/top$/))) {
      // Each player has a few favourite champions, derived from their number.
      const i = players.findIndex((p) => p.puuid === decodeURIComponent(m![1]!));
      const keys = Object.values(CHAMPIONS).map((c) => Number(c.key));
      const count = Number(url.searchParams.get('count') ?? 3);
      return send(200, Array.from({ length: count }, (_, j) => ({ championId: keys[(i * 3 + j * 5) % keys.length], championPoints: 300_000 - j * 40_000 })));
    }
    if ((m = path.match(/^\/europe\/riot\/account\/v1\/accounts\/by-riot-id\/([^/]+)\/([^/]+)$/))) {
      const [name, tag] = [decodeURIComponent(m[1]!), decodeURIComponent(m[2]!)];
      const p = players.find((x) => x.gameName.toLowerCase() === name.toLowerCase() && x.tagLine.toLowerCase() === tag.toLowerCase());
      return p ? send(200, p) : send(404, { status: { status_code: 404 } });
    }
    send(404, { status: { status_code: 404, message: `fake riot: no route ${path}` } });
  });
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  return {
    apiBase: base,
    ddragonBase: `${base}/ddragon`,
    players,
    store,
    hits,
    /** A new game for a player, as if it just ended. */
    addGame(withPlayers: number[]) {
      const id = `TR1_${7_000_000_000 + store.size}`;
      const ten = withPlayers.map((i) => players[i]!);
      for (const p of players) if (ten.length < 10 && !ten.includes(p)) ten.push(p);
      const game = makeGame(id, store.size + 1, ten);
      store.set(id, game);
      for (const p of ten) byPlayer.set(p.puuid, [id, ...(byPlayer.get(p.puuid) ?? [])]);
      return id;
    },
    close: () => new Promise<void>((ok) => server.close(() => ok())),
  };
}
