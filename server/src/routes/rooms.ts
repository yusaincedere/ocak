import type { FastifyInstance } from 'fastify';
import { AccessToken } from 'livekit-server-sdk';
import { z } from 'zod';
import { config } from '../config.js';
import { db, type RoomRow } from '../db.js';
import type { CreatedRoom, JoinResult, ServerConfig } from '../protocol.js';
import { hashPassword, newRoomId, newRoomPassword, normalizeRoomId, passwordMatches } from '../rooms.js';

const createBody = z.object({ createCode: z.string().max(200).optional() });

const joinBody = z.object({
  password: z.string().min(1).max(64),
  name: z.string().trim().min(1).max(32),
  /** Random id the browser/app keeps in local storage; not an account. */
  deviceId: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/),
});

export async function roomRoutes(app: FastifyInstance) {
  app.get('/api/config', async (): Promise<ServerConfig> => ({ createCodeRequired: config.createCode !== null }));

  app.post(
    '/api/rooms',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (req, reply): Promise<CreatedRoom | undefined> => {
      const body = createBody.safeParse(req.body ?? {});
      if (!body.success) return reply.code(400).send({ error: 'Invalid request' });
      if (config.createCode && body.data.createCode?.trim() !== config.createCode)
        return reply.code(403).send({ error: 'Wrong server code', code: 'create_code' });

      let id = newRoomId();
      while (db.prepare('SELECT 1 FROM rooms WHERE id = ?').get(id)) id = newRoomId();
      const password = newRoomPassword();
      const now = Date.now();
      db.prepare('INSERT INTO rooms (id, password_hash, created_at, last_used_at) VALUES (?, ?, ?, ?)').run(
        id,
        hashPassword(password),
        now,
        now,
      );
      return { id, password };
    },
  );

  app.post(
    '/api/rooms/:id/join',
    { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (req, reply): Promise<JoinResult | undefined> => {
      const id = normalizeRoomId((req.params as { id: string }).id);
      const body = joinBody.safeParse(req.body);
      if (!id) return reply.code(404).send({ error: "That room doesn't exist", code: 'not_found' });
      if (!body.success) return reply.code(400).send({ error: 'Invalid request' });

      const room = db.prepare('SELECT * FROM rooms WHERE id = ?').get(id) as RoomRow | undefined;
      if (!room) return reply.code(404).send({ error: "That room doesn't exist (or expired)", code: 'not_found' });
      if (!passwordMatches(body.data.password, room.password_hash))
        return reply.code(403).send({ error: 'Wrong password', code: 'password' });

      db.prepare('UPDATE rooms SET last_used_at = ? WHERE id = ?').run(Date.now(), id);

      // Identity must be unique per connection: the same device may join from two tabs.
      const suffix = Math.random().toString(36).slice(2, 6);
      const at = new AccessToken(config.livekit.apiKey, config.livekit.apiSecret, {
        identity: `${body.data.deviceId}:${suffix}`,
        name: body.data.name,
        ttl: '12h',
      });
      at.addGrant({
        room: `room-${id}`,
        roomJoin: true,
        canPublish: true,
        canSubscribe: true,
        canPublishData: true, // chat + (later) remote control
        canUpdateOwnMetadata: true, // renaming yourself mid-call
      });

      return { url: config.livekit.publicUrl, token: await at.toJwt(), roomId: id };
    },
  );
}
