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
process.env.DESKTOP_DOWNLOAD_URL = 'https://github.com/example/ocak/releases/latest/download/';

let app: FastifyInstance;

before(async () => {
  const { buildApp } = await import('../src/app.js');
  app = await buildApp({ logger: false, rateLimits: false });
});
after(() => app.close());

const join_ = (id: string, body: Record<string, unknown>) =>
  app.inject({ method: 'POST', url: `/api/rooms/${id}/join`, payload: body });
const me = { name: 'Tester', deviceId: 'device12345' };

async function createRoom(lang?: 'tr' | 'en') {
  const res = await app.inject({ method: 'POST', url: '/api/rooms', payload: { createCode: 'testcode', lang } });
  assert.equal(res.statusCode, 200);
  return res.json() as { id: string; password: string };
}

describe('config', () => {
  test('reports that a server code is required', async () => {
    const res = await app.inject('/api/config');
    assert.deepEqual(res.json(), { createCodeRequired: true, avatarGenders: [] });
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

  test('names rooms with a Turkish word and a number by default', async () => {
    const { TR_WORDS } = await import('../src/words.js');
    const room = await createRoom();
    const m = room.id.match(/^([a-z]+)(\d+)$/);
    assert.ok(m, room.id);
    assert.ok(TR_WORDS.includes(m[1]!), room.id);
    assert.ok(Number(m[2]) >= 1 && Number(m[2]) <= 99, room.id);
    assert.match(room.password, /^[a-z2-9]{6}$/);
  });

  test('uses English words when asked', async () => {
    const { EN_WORDS } = await import('../src/words.js');
    const room = await createRoom('en');
    assert.ok(EN_WORDS.includes(room.id.replace(/\d+$/, '')), room.id);
  });

  test('rejects an unknown language', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/rooms', payload: { createCode: 'testcode', lang: 'de' } });
    assert.equal(res.statusCode, 400);
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

  test('accepts names and passwords in any case, with spaces, or typed on a Turkish keyboard', async () => {
    const room = await createRoom();
    const word = room.id.replace(/\d+$/, '');
    const num = room.id.slice(word.length);
    for (const typed of [room.id.toUpperCase(), `${word} ${num}`, `${word}-${num}`, room.id.toLocaleUpperCase('tr')]) {
      const res = await join_(encodeURIComponent(typed), { ...me, password: room.password.toUpperCase() });
      assert.equal(res.statusCode, 200, typed);
      assert.equal(res.json().roomId, room.id, typed);
    }
  });

  test('rooms made before word names still work, with or without the dash', async () => {
    const { db } = await import('../src/db.js');
    const { hashPassword } = await import('../src/rooms.js');
    const now = Date.now();
    db.prepare('INSERT INTO rooms (id, password_hash, created_at, last_used_at) VALUES (?, ?, ?, ?)').run('k7m2-qp4x', hashPassword('h3x9tw'), now, now);
    // "pancake3" is a valid word name *and* 8 old-style letters; the old room must still be found.
    db.prepare('INSERT INTO rooms (id, password_hash, created_at, last_used_at) VALUES (?, ?, ?, ?)').run('panc-ake3', hashPassword('h3x9tw'), now, now);
    for (const [typed, id] of [['k7m2-qp4x', 'k7m2-qp4x'], ['K7M2QP4X', 'k7m2-qp4x'], ['pancake3', 'panc-ake3']]) {
      const res = await join_(typed!, { ...me, password: 'h3x9tw' });
      assert.equal(res.statusCode, 200, typed);
      assert.equal(res.json().roomId, id);
    }
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

describe('desktop downloads', () => {
  test('links point at the configured release location', async () => {
    const res = await app.inject('/api/desktop-downloads');
    assert.deepEqual(res.json(), {
      windows: 'https://github.com/example/ocak/releases/latest/download/Ocak-Setup.exe',
      mac: 'https://github.com/example/ocak/releases/latest/download/Ocak.dmg',
    });
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

describe('room words', () => {
  test('are short lowercase a-z words with no duplicates', async () => {
    const { EN_WORDS, TR_WORDS } = await import('../src/words.js');
    for (const list of [TR_WORDS, EN_WORDS]) {
      assert.ok(list.length >= 100);
      assert.equal(new Set(list).size, list.length, 'duplicate word');
      for (const w of list) assert.match(w, /^[a-z]{2,9}$/);
    }
  });
});
