import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

// In development, load the repo-root .env if there is one.
const rootEnv = resolve(here, '../../.env');
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const env = process.env;
const isProd = env.NODE_ENV === 'production';

export const config = {
  isProd,
  host: env.HOST ?? '0.0.0.0',
  port: Number(env.PORT ?? 3000),
  dbPath: resolve(env.DB_PATH ?? resolve(here, '../data/ocak.db')),
  webDist: resolve(env.WEB_DIST ?? resolve(here, '../../web/dist')),
  /**
   * Where the desktop installers are downloaded from, e.g.
   * https://github.com/you/ocak/releases/latest/download (files Ocak-Setup.exe and Ocak.dmg).
   * If unset, installers placed in downloadsDir are served instead.
   */
  desktopDownloadUrl: env.DESKTOP_DOWNLOAD_URL?.trim().replace(/\/+$/, '') || null,
  /** Desktop installers (Ocak-Setup*.exe, Ocak*.dmg) put here are offered for download. */
  downloadsDir: resolve(env.DOWNLOADS_DIR ?? resolve(here, '../../downloads')),

  /**
   * Optional. If set, starting a new call requires this code (asked once, then remembered
   * by the browser). Joining an existing room never needs it. Stops strangers from using
   * your server for their own calls.
   */
  createCode: env.CREATE_CODE?.trim() || null,

  /**
   * Optional profile pictures. Each is an API that returns JSON with a random image URL
   * (e.g. {"url": "https://…", "dimensions": {"width": 1094, "height": 1825}}).
   * With both set, people pick a gender when they choose their name; with neither, no pictures.
   */
  avatarApis: {
    male: env.AVATAR_API_MALE?.trim() || null,
    female: env.AVATAR_API_FEMALE?.trim() || null,
  },

  /**
   * Optional League of Legends helpers (builds, counters, post-game cards).
   * Needs a Riot API key from developer.riotgames.com; without one the LoL features are hidden.
   */
  lol: {
    apiKey: env.RIOT_API_KEY?.trim() || null,
    /**
     * Servers whose high-elo games feed the build/counter stats. Riot's rate limit is per region,
     * so servers in different regions (europe / asia / americas) add up: more games per hour.
     */
    platforms: (env.LOL_PLATFORMS ?? 'tr1,euw1,kr,na1')
      .split(',')
      .map((p) => p.trim().toLowerCase())
      .filter((p) => /^[a-z]+\d*$/.test(p)),
    /** Set LOL_COLLECT=off to only serve post-game cards (no background stats collection). */
    collect: env.LOL_COLLECT !== 'off',
    /** Overrides for tests: where the Riot API and Data Dragon are. */
    apiBase: env.RIOT_API_BASE?.replace(/\/+$/, '') || null,
    ddragonBase: (env.DDRAGON_BASE ?? 'https://ddragon.leagueoflegends.com').replace(/\/+$/, ''),
  },

  /** Rooms nobody has joined for this many days are deleted. */
  roomTtlDays: Number(env.ROOM_TTL_DAYS ?? 7),

  livekit: {
    /** The URL browsers/desktop clients connect to, e.g. wss://rtc.example.com */
    publicUrl: env.LIVEKIT_PUBLIC_URL ?? 'ws://localhost:7880',
    apiKey: env.LIVEKIT_API_KEY ?? 'devkey',
    apiSecret: env.LIVEKIT_API_SECRET ?? 'secret',
  },
};

if (isProd) {
  const problems: string[] = [];
  if (config.livekit.apiKey === 'devkey' || config.livekit.apiSecret === 'secret')
    problems.push('LIVEKIT_API_KEY / LIVEKIT_API_SECRET are the dev defaults');
  if (config.livekit.apiSecret.length < 32) problems.push('LIVEKIT_API_SECRET must be at least 32 characters');
  if (problems.length) {
    console.error(`Refusing to start in production:\n - ${problems.join('\n - ')}`);
    process.exit(1);
  }
}
