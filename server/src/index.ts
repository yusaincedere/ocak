import { buildApp } from './app.js';
import { config } from './config.js';
import { pruneRooms } from './db.js';
import { Collector } from './lol/collector.js';
import { startStaticDataRefresh } from './lol/ddragon.js';
import { RiotClient } from './lol/riot.js';

// League of Legends helpers are on when a Riot API key is configured.
const riot = config.lol.apiKey ? new RiotClient({ apiKey: config.lol.apiKey, apiBase: config.lol.apiBase }) : null;
const app = await buildApp({ riot });

pruneRooms();
setInterval(pruneRooms, 60 * 60 * 1000).unref();

await app.listen({ host: config.host, port: config.port });

if (riot) {
  const log = (msg: string, err?: unknown) => (err ? app.log.warn({ err }, msg) : app.log.info(msg));
  startStaticDataRefresh(log);
  if (config.lol.collect && config.lol.platforms.length) void new Collector(riot, config.lol.platforms, log).run();
}
