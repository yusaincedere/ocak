import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db, type RoomRow } from '../db.js';
import type { CallControl } from '../livekit.js';
import type { RoomsPresence } from '../protocol.js';
import { passwordMatches } from '../rooms.js';

const presenceBody = z.object({
  /** the recent rooms on the home page, with the passwords this device already has */
  rooms: z
    .array(z.object({ id: z.string().min(1).max(64), password: z.string().min(1).max(64) }))
    .max(12),
});

/** One question to LiveKit about every call, shared by everyone asking within a few seconds. */
const CACHE_MS = 4000;

/**
 * Who is in the call of each room you can already join (you need its password, as for joining):
 * names only, for the home page's recent rooms.
 */
export function presenceRoutes(control: CallControl) {
  let cached: { at: number; people: Promise<Map<string, { name: string }[]>> } | null = null;
  const people = () => {
    if (!cached || Date.now() - cached.at > CACHE_MS)
      cached = { at: Date.now(), people: control.people().catch(() => new Map()) }; // LiveKit down: nobody shown
    return cached.people;
  };

  return async function (app: FastifyInstance) {
    app.post(
      '/api/rooms/presence',
      { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
      async (req, reply): Promise<RoomsPresence | undefined> => {
        const body = presenceBody.safeParse(req.body);
        if (!body.success) return reply.code(400).send({ error: 'Invalid request' });
        const allowed = body.data.rooms.filter((r) => {
          const room = db.prepare('SELECT password_hash FROM rooms WHERE id = ?').get(r.id) as Pick<RoomRow, 'password_hash'> | undefined;
          return !!room && passwordMatches(r.password, room.password_hash);
        });
        const out: RoomsPresence = { rooms: {} };
        if (!allowed.length) return out;
        const now = await people();
        for (const r of allowed) {
          const names = (now.get(r.id) ?? []).map((p) => p.name);
          if (names.length) out.rooms[r.id] = names;
        }
        return out;
      },
    );
  };
}
