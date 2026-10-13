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
  /** Desktop installers (Ocak-Setup-*.exe, Ocak-*.dmg) put here are offered for download. */
  downloadsDir: resolve(env.DOWNLOADS_DIR ?? resolve(here, '../../downloads')),

  /**
   * Optional. If set, starting a new call requires this code (asked once, then remembered
   * by the browser). Joining an existing room never needs it. Stops strangers from using
   * your server for their own calls.
   */
  createCode: env.CREATE_CODE?.trim() || null,

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
