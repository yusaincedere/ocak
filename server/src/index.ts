import { existsSync } from 'node:fs';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import Fastify from 'fastify';
import { config } from './config.js';
import { pruneRooms } from './db.js';
import { downloadRoutes } from './routes/downloads.js';
import { roomRoutes } from './routes/rooms.js';

const app = Fastify({
  logger: { level: config.isProd ? 'info' : 'debug' },
  // In production the app only listens on 127.0.0.1 behind Caddy, so X-Forwarded-For is trustworthy.
  trustProxy: config.isProd,
});

await app.register(rateLimit, { global: false });
await app.register(roomRoutes);
await app.register(downloadRoutes);

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

pruneRooms();
setInterval(pruneRooms, 60 * 60 * 1000).unref();

await app.listen({ host: config.host, port: config.port });
