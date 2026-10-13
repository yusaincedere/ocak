import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import fastifyStatic from '@fastify/static';
import type { FastifyInstance } from 'fastify';
import { config } from '../config.js';

/** Newest file in the downloads folder whose name matches. */
function latest(pattern: RegExp): string | null {
  try {
    const files = readdirSync(config.downloadsDir)
      .filter((f) => pattern.test(f))
      .map((f) => ({ f, t: statSync(join(config.downloadsDir, f)).mtimeMs }))
      .sort((a, b) => b.t - a.t);
    return files[0] ? `/downloads/${encodeURIComponent(files[0].f)}` : null;
  } catch {
    return null; // folder doesn't exist
  }
}

export async function downloadRoutes(app: FastifyInstance) {
  await app.register(fastifyStatic, {
    root: config.downloadsDir,
    prefix: '/downloads/',
    decorateReply: false,
    wildcard: true,
    // the folder may not exist yet; files can be dropped in later without a restart
    allowedPath: (path) => /^\/?Ocak[\w.-]*\.(exe|dmg|AppImage)$/.test(path),
  });

  app.get('/api/desktop-downloads', async () => {
    const base = config.desktopDownloadUrl;
    if (base) return { windows: `${base}/Ocak-Setup.exe`, mac: `${base}/Ocak.dmg` };
    return { windows: latest(/^Ocak-Setup.*\.exe$/), mac: latest(/^Ocak.*\.dmg$/) };
  });
}
