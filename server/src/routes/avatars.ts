// Random profile pictures from the picture APIs set in AVATAR_API_MALE / AVATAR_API_FEMALE.
//
// Images are always served through this server (/api/avatars/<token>) instead of straight
// from the picture site:
//  - people's IP addresses aren't shown to that site, and it can't block hotlinking;
//  - a participant can't make everyone else's app load an arbitrary (tracking) URL, because
//    the token is signed: only URLs that came from the configured APIs are ever fetched.
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { config } from '../config.js';
import type { RandomAvatar } from '../protocol.js';

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const IMAGE_TYPES = /^image\/(jpeg|png|webp|gif|avif)$/; // no SVG: it can carry scripts
const CACHE_BYTES = 24 * 1024 * 1024; // recent images kept in memory, so a call doesn't refetch them

const signingKey = createHmac('sha256', config.livekit.apiSecret).update('ocak-avatar-v1').digest();
const sign = (url: string) => createHmac('sha256', signingKey).update(url).digest('base64url').slice(0, 22);

export const avatarToken = (url: string) => `${Buffer.from(url).toString('base64url')}.${sign(url)}`;

export function urlFromToken(token: string): string | null {
  if (token.length > 4000) return null;
  const [data, sig, extra] = token.split('.');
  if (!data || !sig || extra !== undefined) return null;
  const url = Buffer.from(data, 'base64url').toString();
  const expected = Buffer.from(sign(url));
  const given = Buffer.from(sig);
  return expected.length === given.length && timingSafeEqual(expected, given) ? url : null;
}

const isImageUrl = (raw: string) => {
  try {
    const u = new URL(raw);
    return u.protocol === 'https:' || (u.protocol === 'http:' && !config.isProd);
  } catch {
    return false;
  }
};

const positive = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) && x > 0 ? Math.round(x) : null);

/**
 * Finds the image URL (and its size, if given) in whatever JSON a picture API returns:
 * {"url": …}, {"results": [{"url": …}]}, {"images": [{"image_url": …}]}, …
 * Top-level fields win over nested ones.
 */
export function findImage(json: unknown): { url: string; width: number | null; height: number | null } | null {
  const queue: unknown[] = [json];
  for (let visited = 0; queue.length && visited < 300; visited++) {
    const node = queue.shift();
    if (Array.isArray(node)) {
      queue.push(...node.slice(0, 20));
      continue;
    }
    if (!node || typeof node !== 'object') continue;
    const o = node as Record<string, unknown>;
    for (const key of ['url', 'image_url', 'imageUrl', 'file_url', 'image', 'src']) {
      const v = o[key];
      if (typeof v === 'string' && isImageUrl(v)) {
        const dims = (o.dimensions && typeof o.dimensions === 'object' ? o.dimensions : o) as Record<string, unknown>;
        return { url: v, width: positive(dims.width), height: positive(dims.height) };
      }
    }
    queue.push(...Object.values(o));
  }
  return null;
}

/** Reads a response body, giving up past `max` bytes. */
async function readLimited(res: Response, max: number): Promise<Buffer | null> {
  if (!res.body) return null;
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of res.body) {
    size += chunk.byteLength;
    if (size > max) return null;
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

// Tiny least-recently-used cache, bounded by total size.
const cache = new Map<string, { type: string; body: Buffer }>();
let cachedBytes = 0;
function remember(url: string, entry: { type: string; body: Buffer }) {
  if (entry.body.length > CACHE_BYTES / 4) return;
  cache.set(url, entry);
  cachedBytes += entry.body.length;
  for (const [oldUrl, old] of cache) {
    if (cachedBytes <= CACHE_BYTES) break;
    cache.delete(oldUrl);
    cachedBytes -= old.body.length;
  }
}

const randomBody = z.object({ gender: z.enum(['male', 'female']) });

export async function avatarRoutes(app: FastifyInstance) {
  app.post(
    '/api/avatars/random',
    { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (req, reply): Promise<RandomAvatar | undefined> => {
      const body = randomBody.safeParse(req.body);
      if (!body.success) return reply.code(400).send({ error: 'Invalid request' });
      const api = config.avatarApis[body.data.gender];
      if (!api) return reply.code(404).send({ error: 'No pictures on this server', code: 'no_avatars' });

      // Picture APIs occasionally hiccup or return something odd: try a couple of times.
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const res = await fetch(api, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(6000) });
          if (!res.ok) continue;
          const found = findImage(await res.json());
          if (found) return { src: `/api/avatars/${avatarToken(found.url)}`, width: found.width, height: found.height };
          req.log.warn('Picture API response has no image URL');
        } catch (err) {
          req.log.warn({ err }, 'Picture API request failed');
        }
      }
      return reply.code(502).send({ error: 'Could not get a picture right now', code: 'avatar_failed' });
    },
  );

  app.get(
    '/api/avatars/:token',
    { config: { rateLimit: { max: 240, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const url = urlFromToken((req.params as { token: string }).token);
      if (!url || !isImageUrl(url)) return reply.code(404).send({ error: 'Not found' });

      let image = cache.get(url);
      if (image) {
        cache.delete(url); // move to the "recently used" end
        cache.set(url, image);
      } else {
        try {
          const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
          const type = (res.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
          const body = res.ok && IMAGE_TYPES.test(type) ? await readLimited(res, MAX_IMAGE_BYTES) : null;
          if (!body) return reply.code(502).send({ error: 'Picture unavailable' });
          image = { type, body };
          remember(url, image);
        } catch {
          return reply.code(502).send({ error: 'Picture unavailable' });
        }
      }

      return reply
        .header('content-type', image.type)
        .header('cache-control', 'public, max-age=31536000, immutable')
        .header('x-content-type-options', 'nosniff')
        .send(image.body);
    },
  );
}
