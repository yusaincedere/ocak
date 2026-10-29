import { existsSync } from 'node:fs';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import Fastify from 'fastify';
import { config } from './config.js';
import { avatarRoutes } from './routes/avatars.js';
import { downloadRoutes } from './routes/downloads.js';
import { lolRoutes } from './routes/lol.js';
import type { RiotClient } from './lol/riot.js';
import { roomRoutes } from './routes/rooms.js';

/** Builds the HTTP app without starting it (used by index.ts and the tests). */
export async function buildApp({
  logger = true,
  rateLimits = true,
  riot = null,
}: { logger?: boolean; rateLimits?: boolean; riot?: RiotClient | null } = {}) {
  const app = Fastify({
    logger: logger ? { level: config.isProd ? 'info' : 'debug' } : false,
    // In production the app only listens on 127.0.0.1 behind Caddy, so X-Forwarded-For is trustworthy.
    trustProxy: config.isProd,
    // Picture links (/api/avatars/<signed token>) carry the image URL, often longer than the default 100.
    maxParamLength: 4096,
  });

  // Per-route limits (see routes/rooms.ts). Tests switch them off to make many requests quickly.
  if (rateLimits) await app.register(rateLimit, { global: false });
  await app.register(roomRoutes);
  await app.register(downloadRoutes);
  await app.register(avatarRoutes);
  await app.register(lolRoutes(riot));

  app.get('/api/health', async () => ({ ok: true }));

  // Serve the built web app (production). In development Vite serves it instead.
  if (existsSync(config.webDist)) {
    await app.register(fastifyStatic, { root: config.webDist, wildcard: false });
    app.setNotFoundHandler((req, reply) => {
      if (req.method === 'GET' && !req.url.startsWith('/api')) return reply.sendFile('index.html');
      return reply.code(404).send({ error: 'Not found' });
    });
  } else {
    app.log.info(`No web build at ${config.webDist} - API only (use the Vite dev server for the UI).`);
  }

  return app;
}
