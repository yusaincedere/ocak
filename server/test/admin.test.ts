import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import type { FastifyInstance } from 'fastify';
import type { CallControl } from '../src/livekit.js';
import type { AdminPerson } from '../src/protocol.js';

// Configure before the server modules load (they read env at import time).
process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), 'ocak-admin-test-')), 'test.db');
process.env.ADMIN_KEY = 'admin-key-for-tests';
process.env.CREATE_CODE = '';
process.env.WEB_DIST = '/nonexistent';
process.env.NODE_ENV = 'test';

/** A pretend LiveKit: one call with two people in it. */
const calls = new Map<string, AdminPerson[]>();
const log: string[] = [];
let livekitDown = false;
const control: CallControl = {
  async people() {
    if (livekitDown) throw new Error('connect ECONNREFUSED');
    return new Map(calls);
  },
  async mute(roomId, identity) {
    log.push(`mute ${roomId} ${identity}`);
    return !!calls.get(roomId)?.some((p) => p.identity === identity);
  },
  async kick(roomId, identity) {
    log.push(`kick ${roomId} ${identity}`);
    return !!calls.get(roomId)?.some((p) => p.identity === identity);
  },
  async end(roomId) {
    log.push(`end ${roomId}`);
  },
};

let app: FastifyInstance;
before(async () => {
  const { buildApp } = await import('../src/app.js');
  app = await buildApp({ logger: false, rateLimits: false, control });
});
after(() => app.close());

const KEY = { 'x-admin-key': 'admin-key-for-tests' };
const me = { name: 'Boss', deviceId: 'device12345' };

async function createRoom() {
  const res = await app.inject({ method: 'POST', url: '/api/rooms', payload: {} });
  assert.equal(res.statusCode, 200);
  return res.json() as { id: string; password: string };
}

const identityOf = (token: string) => JSON.parse(Buffer.from(token.split('.')[1]!, 'base64url').toString()).sub as string;
const grantsOf = (token: string) => JSON.parse(Buffer.from(token.split('.')[1]!, 'base64url').toString()).video;

describe('admin key', () => {
  test('config says admin is on', async () => {
    assert.equal((await app.inject('/api/config')).json().adminEnabled, true);
  });

  test('admin routes refuse a missing or wrong key', async () => {
    for (const headers of [{}, { 'x-admin-key': 'nope' }, { 'x-admin-key': '' }]) {
      const res = await app.inject({ url: '/api/admin/rooms', headers });
      assert.equal(res.statusCode, 403);
      assert.equal(res.json().code, 'admin_key');
    }
  });

  test('the right key is accepted (surrounding spaces are fine)', async () => {
    for (const key of ['admin-key-for-tests', '  admin-key-for-tests ']) {
      const res = await app.inject({ url: '/api/admin/check', headers: { 'x-admin-key': key } });
      assert.equal(res.statusCode, 200);
    }
  });
});

describe('rooms dashboard', () => {
  test('lists rooms with who is in the call', async () => {
    const room = await createRoom();
    calls.set(room.id, [{ identity: 'abcdefgh:x1', name: 'Mert', joinedAt: 1, micOn: true }]);
    const res = await app.inject({ url: '/api/admin/rooms', headers: KEY });
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.live, true);
    const row = body.rooms.find((r: { id: string }) => r.id === room.id);
    assert.equal(row.people[0].name, 'Mert');
    assert.ok(row.expiresAt > row.lastUsedAt);
    // passwords are never part of the list
    assert.ok(!JSON.stringify(body).includes(room.password));
  });

  test('still lists rooms when LiveKit is unreachable', async () => {
    livekitDown = true;
    try {
      const res = await app.inject({ url: '/api/admin/rooms', headers: KEY });
      assert.equal(res.statusCode, 200);
      assert.equal(res.json().live, false);
      assert.ok(res.json().rooms.length > 0);
    } finally {
      livekitDown = false;
    }
  });
});

describe('joining as admin', () => {
  test('joins any room without the password, as an admin', async () => {
    const room = await createRoom();
    const res = await app.inject({ method: 'POST', url: `/api/admin/rooms/${room.id}/join`, headers: KEY, payload: me });
    assert.equal(res.statusCode, 200);
    const { token } = res.json();
    assert.equal(grantsOf(token).roomAdmin, true);
    // others in the call can't tell: the identity looks like anyone's
    assert.match(identityOf(token), /^device12345:[a-z0-9]+$/);
  });

  test('a normal join with the admin key also gets admin powers', async () => {
    const room = await createRoom();
    const res = await app.inject({ method: 'POST', url: `/api/rooms/${room.id}/join`, headers: KEY, payload: { ...me, password: room.password } });
    assert.equal(grantsOf(res.json().token).roomAdmin, true);
    assert.match(identityOf(res.json().token), /^device12345:[a-z0-9]+$/);
  });

  test('a normal join is never an admin', async () => {
    const room = await createRoom();
    const res = await app.inject({ method: 'POST', url: `/api/rooms/${room.id}/join`, payload: { ...me, password: room.password } });
    assert.ok(!grantsOf(res.json().token).roomAdmin);
  });

  test('unknown rooms are 404', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/admin/rooms/nosuch99/join', headers: KEY, payload: me });
    assert.equal(res.statusCode, 404);
  });
});

describe('managing rooms', () => {
  test('a new password replaces the old one', async () => {
    const room = await createRoom();
    const res = await app.inject({ method: 'POST', url: `/api/admin/rooms/${room.id}/password`, headers: KEY });
    const { password } = res.json();
    assert.notEqual(password, room.password);
    const join = (pw: string) => app.inject({ method: 'POST', url: `/api/rooms/${room.id}/join`, payload: { ...me, password: pw } });
    assert.equal((await join(room.password)).statusCode, 403);
    assert.equal((await join(password)).statusCode, 200);
  });

  test('ending a call keeps the room', async () => {
    const room = await createRoom();
    const res = await app.inject({ method: 'POST', url: `/api/admin/rooms/${room.id}/end`, headers: KEY });
    assert.equal(res.statusCode, 200);
    assert.ok(log.includes(`end ${room.id}`));
    const join = await app.inject({ method: 'POST', url: `/api/rooms/${room.id}/join`, payload: { ...me, password: room.password } });
    assert.equal(join.statusCode, 200);
  });

  test('deleting a room ends its call and its links stop working', async () => {
    const room = await createRoom();
    const res = await app.inject({ method: 'DELETE', url: `/api/admin/rooms/${room.id}`, headers: KEY });
    assert.equal(res.statusCode, 200);
    assert.ok(log.includes(`end ${room.id}`));
    const join = await app.inject({ method: 'POST', url: `/api/rooms/${room.id}/join`, payload: { ...me, password: room.password } });
    assert.equal(join.statusCode, 404);
  });

  test('mute and kick reach LiveKit, and need the key', async () => {
    const room = await createRoom();
    calls.set(room.id, [{ identity: 'abcdefgh:x1', name: 'Mert', joinedAt: 1, micOn: true }]);
    for (const action of ['mute', 'kick']) {
      const url = `/api/admin/rooms/${room.id}/people/${encodeURIComponent('abcdefgh:x1')}/${action}`;
      assert.equal((await app.inject({ method: 'POST', url })).statusCode, 403);
      assert.equal((await app.inject({ method: 'POST', url, headers: KEY })).statusCode, 200);
      assert.ok(log.includes(`${action} ${room.id} abcdefgh:x1`));
    }
    const gone = await app.inject({ method: 'POST', url: `/api/admin/rooms/${room.id}/people/nobody/kick`, headers: KEY });
    assert.equal(gone.statusCode, 404);
  });
});
