// League of Legends helpers: builds and counters before the game, a summary card after it.
// Only active when RIOT_API_KEY is set; otherwise /api/lol/meta says { enabled: false }.
import type { FastifyInstance, FastifyReply } from 'fastify';
import { DEFAULT_LOL_RANK, isLolTier, tiersFrom, type LolLang, type LolMeta } from '../protocol.js';
import { buildFor, findChampion } from '../lol/builds.js';
import { abilitiesOf, staticData } from '../lol/ddragon.js';
import { latestMatchId, mainChampions, MATCH_ID, matchSummary, parseRiotId, resolveAccount } from '../lol/postgame.js';
import { RiotError, type RiotClient } from '../lol/riot.js';
import { gamesPerPatch } from '../lol/stats.js';

const langOf = (q: unknown): LolLang => ((q as { lang?: string })?.lang === 'en' ? 'en' : 'tr');
/** ?rank=EMERALD → Emerald and above (default Platinum+). */
const tiersOf = (q: unknown) => {
  const rank = (q as { rank?: string })?.rank?.toUpperCase();
  return tiersFrom(isLolTier(rank) ? rank : DEFAULT_LOL_RANK);
};
const PLATFORM = /^[a-z]{2,4}\d?$/;

function riotFailure(reply: FastifyReply, err: unknown) {
  if (err instanceof RiotError) {
    if (err.status === 404) return reply.code(404).send({ error: 'Not found', code: 'not_found' });
    if (err.status === 401 || err.status === 403) return reply.code(503).send({ error: 'Riot API key rejected', code: 'riot_key' });
    if (err.status === 429) return reply.code(503).send({ error: 'Riot API busy', code: 'riot_busy' });
  }
  return reply.code(502).send({ error: 'Riot API unavailable', code: 'riot_down' });
}

export function lolRoutes(riot: RiotClient | null) {
  return async (app: FastifyInstance) => {
    app.get('/api/lol/meta', async (req): Promise<LolMeta> => {
      const data = staticData();
      if (!riot || !data) return { enabled: false };
      const loc = langOf(req.query) === 'tr' ? 'tr_TR' : 'en_US';
      const newest = gamesPerPatch(tiersOf(req.query))[0];
      return {
        enabled: true,
        version: data.version,
        patch: newest?.patch ?? data.patch,
        games: newest?.games ?? 0,
        champions: [...data.champions.values()]
          .map((c) => ({ id: c.id, key: c.key, name: c.name[loc] }))
          .sort((a, b) => a.name.localeCompare(b.name, 'tr')),
      };
    });

    app.get(
      '/api/lol/build/:champion',
      { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } },
      async (req, reply) => {
        const data = staticData();
        if (!riot || !data) return reply.code(404).send({ error: 'LoL helpers are off', code: 'disabled' });
        const champ = findChampion(data, (req.params as { champion: string }).champion);
        if (!champ) return reply.code(404).send({ error: 'Unknown champion', code: 'not_found' });
        const role = (req.query as { role?: string }).role?.toUpperCase();
        const lang = langOf(req.query);
        const build = buildFor(data, champ, role, lang, tiersOf(req.query));
        if (!build) return reply.code(404).send({ error: 'No games collected for this champion yet', code: 'no_data' });
        build.abilities = await abilitiesOf(data, champ.id, lang === 'tr' ? 'tr_TR' : 'en_US');
        return build;
      },
    );

    app.get(
      '/api/lol/account/:riotId',
      { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
      async (req, reply) => {
        if (!riot) return reply.code(404).send({ error: 'LoL helpers are off', code: 'disabled' });
        const raw = (req.params as { riotId: string }).riotId;
        if (!parseRiotId(raw)) return reply.code(400).send({ error: 'Use the form Name#TAG', code: 'riot_id' });
        try {
          const acc = await resolveAccount(riot, raw);
          if (!acc) return reply.code(404).send({ error: 'No such Riot ID', code: 'not_found' });
          return { riotId: `${acc.gameName}#${acc.tagLine}` };
        } catch (err) {
          return riotFailure(reply, err);
        }
      },
    );

    // "Our champions": a friend's most played champions, for one-tap builds.
    app.get(
      '/api/lol/mains/:riotId',
      { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
      async (req, reply) => {
        const data = staticData();
        if (!riot || !data) return reply.code(404).send({ error: 'LoL helpers are off', code: 'disabled' });
        const raw = (req.params as { riotId: string }).riotId;
        const platform = ((req.query as { platform?: string }).platform ?? 'tr1').toLowerCase();
        if (!parseRiotId(raw) || !PLATFORM.test(platform)) return reply.code(400).send({ error: 'Invalid request' });
        try {
          const acc = await resolveAccount(riot, raw);
          if (!acc) return reply.code(404).send({ error: 'No such Riot ID', code: 'not_found' });
          const loc = langOf(req.query) === 'tr' ? 'tr_TR' : 'en_US';
          const champions = (await mainChampions(riot, acc, platform))
            .map((k) => data.champions.get(k))
            .filter((c) => !!c)
            .map((c) => ({ id: c.id, key: c.key, name: c.name[loc] }));
          return { champions };
        } catch (err) {
          return riotFailure(reply, err);
        }
      },
    );

    // Each person in a call asks about once a minute whether their own latest game changed.
    app.get(
      '/api/lol/latest/:riotId',
      { config: { rateLimit: { max: 6, timeWindow: '1 minute' } } },
      async (req, reply) => {
        if (!riot) return reply.code(404).send({ error: 'LoL helpers are off', code: 'disabled' });
        const raw = (req.params as { riotId: string }).riotId;
        const platform = ((req.query as { platform?: string }).platform ?? 'tr1').toLowerCase();
        if (!parseRiotId(raw) || !PLATFORM.test(platform)) return reply.code(400).send({ error: 'Invalid request' });
        try {
          const acc = await resolveAccount(riot, raw);
          if (!acc) return reply.code(404).send({ error: 'No such Riot ID', code: 'not_found' });
          return { matchId: await latestMatchId(riot, acc, platform) };
        } catch (err) {
          return riotFailure(reply, err);
        }
      },
    );

    app.get(
      '/api/lol/match/:id',
      { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
      async (req, reply) => {
        if (!riot) return reply.code(404).send({ error: 'LoL helpers are off', code: 'disabled' });
        const id = (req.params as { id: string }).id.toUpperCase();
        if (!MATCH_ID.test(id)) return reply.code(400).send({ error: 'Invalid match id' });
        try {
          return await matchSummary(riot, id);
        } catch (err) {
          return riotFailure(reply, err);
        }
      },
    );
  };
}

