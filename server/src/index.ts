import { buildApp } from './app.js';
import { config } from './config.js';
import { pruneRooms } from './db.js';

const app = await buildApp();

pruneRooms();
setInterval(pruneRooms, 60 * 60 * 1000).unref();

await app.listen({ host: config.host, port: config.port });
