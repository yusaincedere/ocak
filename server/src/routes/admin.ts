import { createHash, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { config } from '../config.js';
import { db, type RoomRow } from '../db.js';
import { callToken, type CallControl } from '../livekit.js';
import type { AdminPerson, AdminRooms, JoinResult } from '../protocol.js';
import { hashPassword, newRoomPassword, roomIdCandidates } from '../rooms.js';

// Admin = whoever sends the server's ADMIN_KEY in the x-admin-key header. No accounts.

const digest = (s: string) => createHash('sha256').update(s).digest();

/** True when the request carries the admin key (and one is configured). */
export function isAdminRequest(req: FastifyRequest): boolean {
  const given = req.headers['x-admin-key'];
  if (!config.adminKey || typeof given !== 'string' || !given) return false;
  return timingSafeEqual(digest(given.trim()), digest(config.adminKey));
}

const joinBody = z.object({
  name: z.string().trim().min(1).max(32),
  deviceId: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/),
});

const findRoom = (raw: string) =>
  roomIdCandidates(raw)
    .map((candidate) => db.prepare('SELECT * FROM rooms WHERE id = ?').get(candidate) as RoomRow | undefined)
    .find(Boolean);

const notFound = { error: "That room doesn't exist (or expired)", code: 'not_found' };

const voiceBody = z.object({
  /** null: back to their own voice */
  voice: z.enum(['child']).nullable(),
  minutes: z.number().int().min(1).max(60).default(5),
});

export const adminRoutes = (control: CallControl) =>
  async function (app: FastifyInstance) {
    // Generous enough for a dashboard that refreshes, tight enough to make guessing the key hopeless.
    const limited = { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } };

    // preHandler (not onRequest) so the rate limit above also counts wrong guesses.
    app.addHook('preHandler', async (req, reply) => {
      if (!config.adminKey) return reply.code(404).send({ error: 'Admin is not enabled on this server', code: 'admin_off' });
      if (!isAdminRequest(req)) return reply.code(403).send({ error: 'Wrong admin key', code: 'admin_key' });
    });

    app.get('/api/admin/check', limited, async () => ({ ok: true }));

    app.get('/api/admin/rooms', limited, async (req): Promise<AdminRooms> => {
      const rows = db.prepare('SELECT * FROM rooms ORDER BY last_used_at DESC').all() as unknown as RoomRow[];
      let people = new Map<string, AdminPerson[]>();
      let live = true;
      try {
        people = await control.people();
      } catch (err) {
        live = false;
        req.log.warn({ err }, 'admin: could not reach LiveKit');
      }
      const ttl = config.roomTtlDays * 24 * 60 * 60 * 1000;
      return {
        live,
        rooms: rows.map((r) => ({
          id: r.id,
          createdAt: r.created_at,
          lastUsedAt: r.last_used_at,
          expiresAt: r.last_used_at + ttl,
          people: people.get(r.id) ?? [],
        })),
      };
    });

    /** Join any room without its password, as an admin. */
    app.post('/api/admin/rooms/:id/join', limited, async (req, reply): Promise<JoinResult | undefined> => {
      const body = joinBody.safeParse(req.body);
      if (!body.success) return reply.code(400).send({ error: 'Invalid request' });
      const room = findRoom((req.params as { id: string }).id);
      if (!room) return reply.code(404).send(notFound);
      db.prepare('UPDATE rooms SET last_used_at = ? WHERE id = ?').run(Date.now(), room.id);
      const token = await callToken({ roomId: room.id, ...body.data, admin: true });
      return { url: config.livekit.publicUrl, token, roomId: room.id };
    });

    /** A new password; the old invite links stop working. People already in the call stay. */
    app.post('/api/admin/rooms/:id/password', limited, async (req, reply) => {
      const room = findRoom((req.params as { id: string }).id);
      if (!room) return reply.code(404).send(notFound);
      const password = newRoomPassword();
      db.prepare('UPDATE rooms SET password_hash = ? WHERE id = ?').run(hashPassword(password), room.id);
      return { id: room.id, password };
    });

    /** Ends the call for everyone; the room stays and can be joined again. */
    app.post('/api/admin/rooms/:id/end', limited, async (req, reply) => {
      const room = findRoom((req.params as { id: string }).id);
      if (!room) return reply.code(404).send(notFound);
      await control.end(room.id);
      return { ok: true };
    });

    /** Ends the call and deletes the room: its links stop working for good. */
    app.delete('/api/admin/rooms/:id', limited, async (req, reply) => {
      const room = findRoom((req.params as { id: string }).id);
      if (!room) return reply.code(404).send(notFound);
      db.prepare('DELETE FROM rooms WHERE id = ?').run(room.id);
      db.prepare('DELETE FROM messages WHERE room_id = ?').run(room.id);
      await control.end(room.id).catch((err: unknown) => req.log.warn({ err }, 'admin: could not end the call'));
      return { ok: true };
    });

    for (const action of ['mute', 'kick', 'knock'] as const) {
      app.post(`/api/admin/rooms/:id/people/:identity/${action}`, limited, async (req, reply) => {
        const { id, identity } = req.params as { id: string; identity: string };
        const room = findRoom(id);
        if (!room) return reply.code(404).send(notFound);
        const done = await control[action](room.id, identity);
        if (!done) return reply.code(404).send({ error: 'That person is not in the call', code: 'not_in_call' });
        return { ok: true };
      });
    }

    // Changes someone's voice for a few minutes: their own app does it to their microphone, so
    // everyone hears it. It ends on its own (their app checks the time; we also clear it).
    const voiceTimers = new Map<string, NodeJS.Timeout>();
    app.post('/api/admin/rooms/:id/people/:identity/voice', limited, async (req, reply) => {
      const { id, identity } = req.params as { id: string; identity: string };
      const body = voiceBody.safeParse(req.body);
      if (!body.success) return reply.code(400).send({ error: 'Invalid request' });
      const room = findRoom(id);
      if (!room) return reply.code(404).send(notFound);
      const until = Date.now() + body.data.minutes * 60_000;
      const value = body.data.voice ? `${body.data.voice}:${until}` : '';
      const done = await control.setVoice(room.id, identity, value);
      if (!done) return reply.code(404).send({ error: 'That person is not in the call', code: 'not_in_call' });
      const key = `${room.id} ${identity}`;
      clearTimeout(voiceTimers.get(key));
      voiceTimers.delete(key);
      if (body.data.voice) {
        const timer = setTimeout(() => {
          voiceTimers.delete(key);
          control.setVoice(room.id, identity, '').catch(() => {}); // they may have left
        }, until - Date.now());
        timer.unref();
        voiceTimers.set(key, timer);
      }
      return { ok: true, until: body.data.voice ? until : null };
    });
    app.addHook('onClose', async () => {
      for (const timer of voiceTimers.values()) clearTimeout(timer);
    });
  };
