import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import type { FastifyInstance } from 'fastify';
import type { CallControl } from '../src/livekit.js';

// Configure before the server modules load (they read env at import time).
process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), 'ocak-messages-test-')), 'test.db');
process.env.ADMIN_KEY = 'admin-key-for-tests';
process.env.CREATE_CODE = '';
process.env.WEB_DIST = '/nonexistent';
process.env.NODE_ENV = 'test';

const control: CallControl = { people: async () => new Map(), mute: async () => false, kick: async () => false, end: async () => {}, setVoice: async () => false };

let app: FastifyInstance;
before(async () => {
  const { buildApp } = await import('../src/app.js');
  app = await buildApp({ logger: false, rateLimits: false, control });
});
after(() => app.close());

async function joined(name = 'Mert') {
  const room = (await app.inject({ method: 'POST', url: '/api/rooms', payload: {} })).json() as { id: string; password: string };
  const res = await app.inject({
    method: 'POST',
    url: `/api/rooms/${room.id}/join`,
    payload: { password: room.password, name, deviceId: 'device12345' },
  });
  return { ...room, token: res.json().token as string };
}
const auth = (token: string) => ({ authorization: `Bearer ${token}` });
const save = (roomId: string, token: string, payload: object) =>
  app.inject({ method: 'POST', url: `/api/rooms/${roomId}/messages`, headers: auth(token), payload });
const load = (roomId: string, token?: string) =>
  app.inject({ url: `/api/rooms/${roomId}/messages`, headers: token ? auth(token) : {} });

describe('saved group chat', () => {
  test('messages are saved and come back in order, from whoever the token says', async () => {
    const r = await joined('Mert');
    assert.equal((await save(r.id, r.token, { id: 'm1', body: 'selam' })).statusCode, 200);
    assert.equal((await save(r.id, r.token, { id: 'm2', body: 'naber', name: 'Mert Can' })).statusCode, 200);
    // the same message twice is kept once
    await save(r.id, r.token, { id: 'm1', body: 'selam' });
    const res = await load(r.id, r.token);
    assert.equal(res.statusCode, 200);
    const { messages } = res.json();
    assert.deepEqual(
      messages.map((m: { id: string; body: string; name: string }) => [m.id, m.body, m.name]),
      [['m1', 'selam', 'Mert'], ['m2', 'naber', 'Mert Can']],
    );
    assert.match(messages[0].identity, /^device12345:/);
  });

  test("only people with a call token for that room can read or write", async () => {
    const mine = await joined();
    const other = await joined();
    await save(mine.id, mine.token, { id: 'secret', body: 'only us' });
    for (const res of [
      await load(mine.id),
      await load(mine.id, other.token), // a token for another room
      await load(mine.id, 'not-a-token'),
      await save(mine.id, other.token, { id: 'x', body: 'hi' }),
      await app.inject({ method: 'POST', url: `/api/rooms/${mine.id}/messages`, payload: { id: 'x', body: 'hi' } }),
    ])
      assert.equal(res.statusCode, 403);
    assert.equal((await load(other.id, other.token)).json().messages.length, 0);
  });

  test('bad messages are refused', async () => {
    const r = await joined();
    for (const payload of [{}, { id: 'a' }, { id: 'a', body: '' }, { id: 'a', body: 'x'.repeat(4001) }, { id: '', body: 'x' }])
      assert.equal((await save(r.id, r.token, payload)).statusCode, 400);
  });

  test('only the newest 200 messages are kept', async () => {
    const r = await joined();
    for (let i = 0; i < 205; i++) await save(r.id, r.token, { id: `n${i}`, body: `#${i}` });
    const { messages } = (await load(r.id, r.token)).json();
    assert.equal(messages.length, 200);
    assert.equal(messages[0].body, '#5');
    assert.equal(messages[199].body, '#204');
  });

  test("deleting a room deletes its chat", async () => {
    const r = await joined();
    await save(r.id, r.token, { id: 'bye', body: 'gone soon' });
    await app.inject({ method: 'DELETE', url: `/api/admin/rooms/${r.id}`, headers: { 'x-admin-key': 'admin-key-for-tests' } });
    const { db } = await import('../src/db.js');
    assert.equal((db.prepare('SELECT COUNT(*) AS n FROM messages WHERE room_id = ?').get(r.id) as { n: number }).n, 0);
  });
});
