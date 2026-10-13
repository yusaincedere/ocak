import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import type { FastifyInstance } from 'fastify';

// Configure before the server modules load (they read env at import time).
process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), 'ocak-test-')), 'test.db');
process.env.CREATE_CODE = 'testcode';
process.env.WEB_DIST = '/nonexistent';
process.env.NODE_ENV = 'test';

let app: FastifyInstance;

before(async () => {
  const { buildApp } = await import('../src/app.js');
  app = await buildApp({ logger: false, rateLimits: false });
});
after(() => app.close());

const join_ = (id: string, body: Record<string, unknown>) =>
  app.inject({ method: 'POST', url: `/api/rooms/${id}/join`, payload: body });
const me = { name: 'Tester', deviceId: 'device12345' };

async function createRoom() {
  const res = await app.inject({ method: 'POST', url: '/api/rooms', payload: { createCode: 'testcode' } });
  assert.equal(res.statusCode, 200);
  return res.json() as { id: string; password: string };
}

describe('config', () => {
  test('reports that a server code is required', async () => {
    const res = await app.inject('/api/config');
    assert.deepEqual(res.json(), { createCodeRequired: true });
  });
});

describe('creating rooms', () => {
  test('rejects a missing or wrong server code', async () => {
    for (const payload of [{}, { createCode: 'nope' }]) {
      const res = await app.inject({ method: 'POST', url: '/api/rooms', payload });
      assert.equal(res.statusCode, 403);
      assert.equal(res.json().code, 'create_code');
    }
  });

  test('accepts the server code regardless of case and extra spaces', async () => {
    for (const createCode of ['TESTCODE', '  testcode ', 'TestCode']) {
      const res = await app.inject({ method: 'POST', url: '/api/rooms', payload: { createCode } });
      assert.equal(res.statusCode, 200, createCode);
    }
  });

  test('returns a readable id and password', async () => {
    const room = await createRoom();
    assert.match(room.id, /^[a-z2-9]{4}-[a-z2-9]{4}$/);
    assert.match(room.password, /^[a-z2-9]{6}$/);
  });

  test('ids are unique', async () => {
    const ids = new Set<string>();
    for (let i = 0; i < 8; i++) ids.add((await createRoom()).id);
    assert.equal(ids.size, 8);
  });
});

describe('joining rooms', () => {
  test('gives a LiveKit token for the right password', async () => {
    const room = await createRoom();
    const res = await join_(room.id, { ...me, password: room.password });
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.roomId, room.id);
    assert.equal(typeof body.url, 'string');

    const claims = JSON.parse(Buffer.from(body.token.split('.')[1], 'base64url').toString());
    assert.equal(claims.name, 'Tester');
    assert.equal(claims.video.room, `room-${room.id}`);
    assert.equal(claims.video.roomJoin, true);
    assert.ok(claims.sub.startsWith('device12345:'));
  });

  test('accepts ids and passwords in any case, with or without the dash', async () => {
    const room = await createRoom();
    const id = room.id.replace('-', '').toUpperCase();
    const res = await join_(id, { ...me, password: room.password.toUpperCase() });
    assert.equal(res.statusCode, 200);
  });

  test('rejects a wrong password', async () => {
    const room = await createRoom();
    const res = await join_(room.id, { ...me, password: 'wrong1' });
    assert.equal(res.statusCode, 403);
    assert.equal(res.json().code, 'password');
  });

  test('unknown and malformed rooms are not found', async () => {
    for (const id of ['abcd-efgh', 'nope', 'zzzz-zzz0']) {
      const res = await join_(id, { ...me, password: 'whatever' });
      assert.equal(res.statusCode, 404, id);
    }
  });

  test('validates name and device id', async () => {
    const room = await createRoom();
    for (const bad of [{ name: '' }, { name: 'x'.repeat(33) }, { deviceId: 'short' }, { deviceId: 'bad id with spaces!' }]) {
      const res = await join_(room.id, { ...me, password: room.password, ...bad });
      assert.equal(res.statusCode, 400, JSON.stringify(bad));
    }
  });
});

describe('abuse protection', () => {
  test('starting calls is rate limited per client', async () => {
    const { buildApp } = await import('../src/app.js');
    const limited = await buildApp({ logger: false });
    try {
      const codes: number[] = [];
      for (let i = 0; i < 11; i++) {
        const res = await limited.inject({ method: 'POST', url: '/api/rooms', payload: { createCode: 'testcode' } });
        codes.push(res.statusCode);
      }
      assert.deepEqual(codes.slice(0, 10), Array(10).fill(200));
      assert.equal(codes[10], 429);
    } finally {
      await limited.close();
    }
  });

  test('passwords are not stored in clear text', async () => {
    const room = await createRoom();
    const { db } = await import('../src/db.js');
    const row = db.prepare('SELECT password_hash FROM rooms WHERE id = ?').get(room.id) as { password_hash: string };
    assert.notEqual(row.password_hash, room.password);
    assert.ok(!row.password_hash.includes(room.password));
  });
});

describe('expiry', () => {
  test('rooms unused for longer than the TTL are pruned', async () => {
    const room = await createRoom();
    const { db, pruneRooms } = await import('../src/db.js');
    db.prepare('UPDATE rooms SET last_used_at = 0 WHERE id = ?').run(room.id);
    pruneRooms();
    const res = await join_(room.id, { ...me, password: room.password });
    assert.equal(res.statusCode, 404);
  });
});
