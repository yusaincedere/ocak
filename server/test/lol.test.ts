import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import type { FastifyInstance } from 'fastify';
import { startFakeRiot } from './fixtures/lol.js';

process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), 'ocak-lol-')), 'test.db');
process.env.WEB_DIST = '/nonexistent';
process.env.NODE_ENV = 'test';

const { skillOrder, purchases, itemPath, runeKey, parseRuneKey } = await import('../src/lol/extract.js');
const { RateLimiter, RiotClient, parseLimits, regionOf } = await import('../src/lol/riot.js');
const { pickBest, wilson } = await import('../src/lol/stats.js');
const { parseRiotId } = await import('../src/lol/postgame.js');

describe('reading a game', () => {
  test('skill max order and first three levels', () => {
    assert.deepEqual(skillOrder([1, 3, 2, 1, 1, 4, 1, 2, 1, 2, 4, 2, 2, 3, 3, 4, 3, 3]), { order: 'QWE', first: 'QEW' });
    assert.deepEqual(skillOrder([3, 1, 2, 3, 3, 4, 3, 1, 3, 1, 4, 1, 1, 2, 2]), { order: 'EQW', first: 'EQW' });
    // Game ended before anything was maxed.
    assert.deepEqual(skillOrder([1, 2, 3, 1]), { order: null, first: 'QWE' });
  });

  test('undone purchases do not count', () => {
    const bought = purchases([
      { type: 'ITEM_PURCHASED', itemId: 1056, timestamp: 1 },
      { type: 'ITEM_PURCHASED', itemId: 2003, timestamp: 2 },
      { type: 'ITEM_UNDO', beforeId: 2003, afterId: 0, timestamp: 3 },
      { type: 'ITEM_PURCHASED', itemId: 3089, timestamp: 4 },
    ]);
    assert.deepEqual(
      bought.map((b) => b.itemId),
      [1056, 3089],
    );
  });

  test('item path: starting items, first three core items, boots', () => {
    const items = new Map(
      [
        [1056, { total: 400, final: true }],
        [2003, { total: 50, final: true, consumable: true }],
        [3802, { total: 1200, final: false }],
        [3020, { total: 1100, final: true, boots: true }],
        [6655, { total: 2850, final: true }],
        [4645, { total: 3200, final: true }],
        [3089, { total: 3500, final: true }],
        [3157, { total: 3250, final: true }],
      ].map(([id, i]) => [
        id as number,
        { id: id as number, name: { en_US: '', tr_TR: '' }, boots: false, consumable: false, trinket: false, purchasable: true, onRift: true, ...(i as object) },
      ]),
    ) as never;
    const at = (itemId: number, timestamp: number) => ({ itemId, timestamp });
    assert.deepEqual(itemPath([at(2003, 10_000), at(1056, 12_000), at(3802, 300_000), at(6655, 400_000), at(3020, 500_000), at(4645, 600_000), at(3089, 700_000), at(3157, 800_000)], items), {
      start: '1056,2003',
      core: '6655,4645,3089',
      boots: '3020',
    });
  });

  test('rune pages', () => {
    const key = runeKey({
      statPerks: { offense: 5008, flex: 5008, defense: 5011 },
      styles: [
        { description: 'primaryStyle', style: 8100, selections: [8112, 8139, 8138, 8135].map((perk) => ({ perk })) },
        { description: 'subStyle', style: 8200, selections: [8226, 8210].map((perk) => ({ perk })) },
      ],
    });
    assert.equal(key, '8100:8112-8139-8138-8135|8200:8210-8226|5008-5008-5011');
    assert.deepEqual(parseRuneKey(key!), { primaryStyle: 8100, primary: [8112, 8139, 8138, 8135], subStyle: 8200, sub: [8210, 8226], shards: [5008, 5008, 5011] });
  });

  test('Riot IDs and regions', () => {
    assert.deepEqual(parseRiotId('Yusa#TR1'), { gameName: 'Yusa', tagLine: 'TR1' });
    assert.deepEqual(parseRiotId('  Kara Kurt #1234 '.replace(' #', '#')), { gameName: 'Kara Kurt', tagLine: '1234' });
    for (const bad of ['Yusa', '#TR1', 'ab#TR1', 'Yusa#', 'x'.repeat(17) + '#TR1']) assert.equal(parseRiotId(bad), null, bad);
    assert.equal(regionOf('tr1'), 'europe');
    assert.equal(regionOf('euw1'), 'europe');
    assert.equal(regionOf('na1'), 'americas');
  });
});

describe('choosing what to recommend', () => {
  test('a popular option with a solid win rate beats a rare lucky one', () => {
    const best = pickBest([
      { value: 'common', games: 400, wins: 212 },
      { value: 'lucky', games: 6, wins: 6 },
      { value: 'worse', games: 300, wins: 140 },
    ]);
    assert.equal(best?.value, 'common');
    assert.ok(wilson(212, 400) > wilson(140, 300));
    assert.equal(pickBest([]), null);
  });
});

describe('rate limits', () => {
  test('waits when a window is full and keeps a reserve for people', () => {
    let now = 0;
    const lim = new RateLimiter([{ limit: 10, ms: 1000 }], 0.7, () => now);
    for (let i = 0; i < 7; i++) {
      assert.equal(lim.delay('background'), 0);
      lim.record();
    }
    assert.ok(lim.delay('background') > 0, 'background stops at 70%');
    assert.equal(lim.delay('interactive'), 0, 'people still get through');
    for (let i = 0; i < 3; i++) lim.record();
    assert.ok(lim.delay('interactive') > 0);
    now = 1001;
    assert.equal(lim.delay('interactive'), 0, 'window rolled over');
    assert.deepEqual(parseLimits('20:1,100:120'), [
      { limit: 20, ms: 1000 },
      { limit: 100, ms: 120_000 },
    ]);
  });

  test('each region has its own budget, like Riot counts it', () => {
    const riot = new RiotClient({ apiKey: 'RGAPI-test' });
    assert.notEqual(riot.limiterFor('europe'), riot.limiterFor('asia'));
    assert.notEqual(riot.limiterFor('europe'), riot.limiterFor('tr1'));
    assert.equal(riot.limiterFor('europe'), riot.limiterFor('europe'));
  });
});

describe('collector + API against a fake Riot API', () => {
  let fake: Awaited<ReturnType<typeof startFakeRiot>>;
  let app: FastifyInstance;
  let off: FastifyInstance;

  before(async () => {
    fake = await startFakeRiot({ games: 240, playerCount: 200 });
    const { loadStaticData, setStaticData } = await import('../src/lol/ddragon.js');
    const { RiotClient } = await import('../src/lol/riot.js');
    const { Collector } = await import('../src/lol/collector.js');
    const { buildApp } = await import('../src/app.js');

    setStaticData(await loadStaticData(undefined, fake.ddragonBase));
    const riot = new RiotClient({ apiKey: 'RGAPI-test', apiBase: fake.apiBase });
    // A fake clock, so players met in games become due without waiting hours.
    let clock = Date.now();
    const collector = new Collector(riot, ['tr1'], () => {}, () => clock);
    await collector.seedIfDue();
    for (let round = 0; round < 4; round++) {
      for (let i = 0; i < 500 && (await collector.step('15.21')); i++);
      clock += 2 * 60 * 60 * 1000;
    }
    app = await buildApp({ logger: false, rateLimits: false, riot });
    off = await buildApp({ logger: false, rateLimits: false, riot: null });
  });
  after(async () => {
    await app.close();
    await off.close();
    await fake.close();
  });

  test('without a Riot key the helpers are off', async () => {
    assert.deepEqual((await off.inject('/api/lol/meta')).json(), { enabled: false });
    assert.equal((await off.inject('/api/lol/build/Ahri')).statusCode, 404);
  });

  test('meta lists champions and how much data there is', async () => {
    const meta = (await app.inject('/api/lol/meta?lang=en')).json();
    assert.equal(meta.enabled, true);
    assert.equal(meta.version, '15.21.1');
    assert.equal(meta.patch, '15.21');
    assert.ok(meta.games >= 150, `games ${meta.games}`);
    assert.ok(meta.champions.some((c: { id: string }) => c.id === 'LeeSin'));
  });

  test('Ahri mid: skills, items, runes and spells from the collected games', async () => {
    const res = await app.inject('/api/lol/build/ahri?role=middle&lang=en');
    assert.equal(res.statusCode, 200, res.body);
    const b = res.json();
    assert.equal(b.champion.id, 'Ahri');
    assert.equal(b.role, 'MIDDLE');
    assert.deepEqual(b.skills, { order: 'QWE', first: 'QEW' });
    assert.deepEqual(
      b.core.map((i: { id: number }) => i.id),
      [6655, 4645, 3089],
    );
    assert.equal(b.core[0].name, "Luden's Companion");
    assert.deepEqual(
      b.abilities.map((a: { key: string; image: string }) => `${a.key}:${a.image}`),
      ['Q:AhriQ.png', 'W:AhriW.png', 'E:AhriE.png', 'R:AhriR.png'],
    );
    assert.equal(b.boots.id, 3020);
    assert.deepEqual(
      b.start.map((i: { id: number }) => i.id),
      [1056, 2003, 2003],
    );
    assert.equal(b.runes.keystone.id, 8112);
    assert.equal(b.runes.primary.id, 8100);
    assert.equal(b.runes.secondary.id, 8200);
    assert.deepEqual(b.runes.shards, [5008, 5008, 5011]);
    assert.deepEqual(
      b.spells.map((s: { id: number }) => s.id),
      [14, 4],
      'Flash goes last',
    );
  });

  test('build variants: the main build first, the Rabadon-first build second', async () => {
    const b = (await app.inject('/api/lol/build/ahri?role=MIDDLE&lang=en')).json();
    assert.ok(b.variants.length >= 2, JSON.stringify(b.variants));
    const [main, alt] = b.variants;
    assert.deepEqual(main.core.map((i: { id: number }) => i.id), [6655, 4645, 3089]);
    assert.deepEqual(main.core, b.core);
    assert.deepEqual(alt.core.map((i: { id: number }) => i.id), [3089, 6655, 4645]);
    assert.equal(alt.runes.keystone.id, 8112);
    assert.ok(main.games > alt.games);
    assert.ok(main.pickRate > 50 && alt.pickRate > 10 && main.pickRate + alt.pickRate <= 100);
  });

  test('counters: Zed is hard for Ahri, Lux is easy', async () => {
    const b = (await app.inject('/api/lol/build/103?role=MIDDLE')).json();
    assert.equal(b.counters.hard[0].champion.id, 'Zed');
    assert.ok(b.counters.hard[0].winRate < 45);
    assert.equal(b.counters.easy[0].champion.id, 'Lux');
    assert.ok(b.counters.easy[0].winRate > 55);
  });

  test('matchups from a handful of games stay believable', async () => {
    const { matchupWinRate } = await import('../src/lol/builds.js');
    const pct = (w: number, g: number) => Math.round(matchupWinRate(w, g) * 100);
    assert.equal(pct(0, 5), 43, '0 wins in 5 is not 0%');
    assert.equal(pct(5, 5), 57, '5 wins in 5 is not 100%');
    assert.equal(pct(400, 1000), 40, 'with lots of games the real number wins');
    const b = (await app.inject('/api/lol/build/ahri?role=MIDDLE')).json();
    for (const c of [...b.counters.hard, ...b.counters.easy]) {
      assert.ok(c.games >= 5, `${c.champion.id}: ${c.games} games`);
      assert.ok(c.winRate > 20 && c.winRate < 80, `${c.champion.id}: ${c.winRate}%`);
    }
  });

  test('rank ranges: Master+ is a subset of Gold+, Platinum+ is the default', async () => {
    const games = async (q: string) => (await app.inject(`/api/lol/meta${q}`)).json().games as number;
    const [gold, def, master] = [await games('?rank=GOLD'), await games(''), await games('?rank=master')];
    assert.ok(master > 0, 'Master+ has games (seeded from the Challenger ladder)');
    assert.ok(master < gold, `Master+ ${master} < Gold+ ${gold}`);
    assert.equal(def, await games('?rank=PLATINUM'));
    assert.equal(await games('?rank=nonsense'), def, 'unknown ranks fall back to the default');
    const b = (await app.inject('/api/lol/build/ahri?role=MIDDLE&rank=MASTER')).json();
    assert.ok(b.games > 0 && b.games < (await app.inject('/api/lol/build/ahri?role=MIDDLE&rank=GOLD')).json().games);
  });

  test('unknown champions and champions without games', async () => {
    assert.equal((await app.inject('/api/lol/build/Teemo')).statusCode, 404);
  });

  test('post-game: latest game by Riot ID, then its summary', async () => {
    const id = fake.addGame([0, 1]);
    const latest = (await app.inject(`/api/lol/latest/${encodeURIComponent('yusa#tr1')}?platform=tr1`)).json();
    assert.equal(latest.matchId, id);
    const res = await app.inject(`/api/lol/match/${id}`);
    assert.equal(res.statusCode, 200);
    const m = res.json();
    assert.equal(m.players.length, 10);
    assert.equal(m.players[0].riotId, 'Yusa#TR1');
    assert.ok(m.players.every((p: { damage: number }) => p.damage > 0));
    assert.equal((await app.inject(`/api/lol/latest/${encodeURIComponent('Nobody#TR1')}`)).statusCode, 404);
    assert.equal((await app.inject('/api/lol/match/not-a-match')).statusCode, 400);
    assert.equal((await app.inject(`/api/lol/account/${encodeURIComponent('Mert#TR1')}`)).json().riotId, 'Mert#TR1');
  });

  test("a friend's most played champions", async () => {
    const res = await app.inject(`/api/lol/mains/${encodeURIComponent('Mert#TR1')}?platform=tr1&lang=en`);
    assert.equal(res.statusCode, 200, res.body);
    const { champions } = res.json();
    assert.equal(champions.length, 5);
    assert.ok(champions.every((c: { id: string; name: string }) => c.id && c.name));
  });

  test('match summaries are cached (one Riot request per game)', async () => {
    const id = fake.addGame([2]);
    const before = fake.hits['/europe/lol/match/v5/matches/:x'] ?? 0;
    for (let i = 0; i < 3; i++) assert.equal((await app.inject(`/api/lol/match/${id}`)).statusCode, 200);
    assert.equal((fake.hits['/europe/lol/match/v5/matches/:x'] ?? 0) - before, 1);
  });
});
