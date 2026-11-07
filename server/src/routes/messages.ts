import type { FastifyInstance, FastifyRequest } from 'fastify';
import { TokenVerifier } from 'livekit-server-sdk';
import { z } from 'zod';
import { config } from '../config.js';
import { CHAT_KEEP_DAYS, CHAT_KEEP_MESSAGES, db } from '../db.js';
import { livekitRoom } from '../livekit.js';
import type { SavedMessage } from '../protocol.js';

const verifier = new TokenVerifier(config.livekit.apiKey, config.livekit.apiSecret);

/**
 * Who is asking: someone with a call token for this room (the one they got when joining). That
 * token is signed by us, so it can't be made up, and it only works for its own room.
 */
async function caller(req: FastifyRequest, roomId: string) {
  const token = /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1];
  if (!token) return null;
  try {
    const claims = await verifier.verify(token);
    if (!claims.sub || !claims.video?.roomJoin || claims.video.room !== livekitRoom(roomId)) return null;
    return { identity: claims.sub, name: claims.name ?? claims.sub };
  } catch {
    return null; // expired, signed with another key, or not a token at all
  }
}

const saveBody = z.object({
  id: z.string().min(1).max(64),
  body: z.string().min(1).max(4000),
  /** the sender's name now, if they renamed since joining */
  name: z.string().trim().min(1).max(32).optional(),
});

type Row = { id: string; identity: string; name: string; body: string; sent_at: number };

/** A room's group chat (text messages), kept so it's still there next time: newest 200, for 30 days. */
export async function messageRoutes(app: FastifyInstance) {
  const roomExists = (id: string) => !!db.prepare('SELECT 1 FROM rooms WHERE id = ?').get(id);
  const denied = { error: 'Not in this call', code: 'not_in_call' };

  app.get('/api/rooms/:id/messages', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req, reply) => {
    const roomId = (req.params as { id: string }).id;
    if (!(await caller(req, roomId)) || !roomExists(roomId)) return reply.code(403).send(denied);
    const rows = db
      .prepare(
        `SELECT id, identity, name, body, sent_at FROM messages
         WHERE room_id = ? AND sent_at >= ? ORDER BY sent_at DESC, rowid DESC LIMIT ?`,
      )
      .all(roomId, Date.now() - CHAT_KEEP_DAYS * 24 * 60 * 60 * 1000, CHAT_KEEP_MESSAGES) as Row[];
    const messages: SavedMessage[] = rows
      .reverse()
      .map((r) => ({ id: r.id, identity: r.identity, name: r.name, body: r.body, sentAt: r.sent_at }));
    return { messages };
  });

  app.post('/api/rooms/:id/messages', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (req, reply) => {
    const roomId = (req.params as { id: string }).id;
    const who = await caller(req, roomId);
    if (!who || !roomExists(roomId)) return reply.code(403).send(denied);
    const body = saveBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'Invalid request' });
    const m = body.data;
    // The sender is whoever the token says; only the name may be newer (a rename mid-call).
    db.prepare('INSERT OR IGNORE INTO messages (room_id, id, identity, name, body, sent_at) VALUES (?, ?, ?, ?, ?, ?)').run(
      roomId,
      m.id,
      who.identity,
      m.name ?? who.name,
      m.body,
      Date.now(),
    );
    // Only the newest messages stay.
    db.prepare(
      `DELETE FROM messages WHERE room_id = ? AND rowid NOT IN
         (SELECT rowid FROM messages WHERE room_id = ? ORDER BY sent_at DESC, rowid DESC LIMIT ?)`,
    ).run(roomId, roomId, CHAT_KEEP_MESSAGES);
    return { ok: true };
  });
}
