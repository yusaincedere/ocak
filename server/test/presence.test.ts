import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import type { FastifyInstance } from 'fastify';
import type { CallControl } from '../src/livekit.js';
import type { AdminPerson } from '../src/protocol.js';

// Configure before the server modules load (they read env at import time).
process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), 'ocak-presence-test-')), 'test.db');
process.env.ADMIN_KEY = '';
process.env.CREATE_CODE = '';
process.env.WEB_DIST = '/nonexistent';
process.env.NODE_ENV = 'test';

const calls = new Map<string, AdminPerson[]>();
let asked = 0;
const fake = (down = false): CallControl => ({
  async people() {
    asked++;
    if (down) throw new Error('connect ECONNREFUSED');
    return new Map(calls);
  },
  mute: async () => false,
  kick: async () => false,
  end: async () => {},
  knock: async () => false, setVoice: async () => false,
});

let app: FastifyInstance;
let downApp: FastifyInstance;
before(async () => {
  const { buildApp } = await import('../src/app.js');
  app = await buildApp({ logger: false, rateLimits: false, control: fake() });
  downApp = await buildApp({ logger: false, rateLimits: false, control: fake(true) });
});
after(async () => {
  await app.close();
  await downApp.close();
});

const person = (name: string): AdminPerson => ({ identity: `${name}:x`, name, joinedAt: 1, micOn: true });
async function createRoom() {
  const res = await app.inject({ method: 'POST', url: '/api/rooms', payload: {} });
  return res.json() as { id: string; password: string };
}
const ask = (on: FastifyInstance, rooms: { id: string; password: string }[]) =>
  on.inject({ method: 'POST', url: '/api/rooms/presence', payload: { rooms } });

describe("who's in your rooms", () => {
  test('names in calls of rooms you have the password for; empty and unknown rooms are left out', async () => {
    const busy = await createRoom();
    const quiet = await createRoom();
    const secret = await createRoom();
    calls.set(busy.id, [person('Mert'), person('Ayşe')]);
    calls.set(secret.id, [person('Gizli')]);

    const res = await ask(app, [busy, quiet, { id: secret.id, password: 'wrong-password' }, { id: 'nosuch99', password: 'x' }]);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.json(), { rooms: { [busy.id]: ['Mert', 'Ayşe'] } });

    // no password, nothing at all
    assert.deepEqual((await ask(app, [{ id: secret.id, password: 'nope' }])).json(), { rooms: {} });
  });

  test('LiveKit is asked once for everyone polling at the same time', async () => {
    const room = await createRoom();
    const before = asked;
    await Promise.all([ask(app, [room]), ask(app, [room]), ask(app, [room])]);
    assert.ok(asked - before <= 1);
  });

  test('when LiveKit is down nobody is shown, without an error', async () => {
    const room = await createRoom();
    calls.set(room.id, [person('Mert')]);
    const res = await ask(downApp, [room]);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.json(), { rooms: {} });
  });

  test('bad requests are refused', async () => {
    const tooMany = Array.from({ length: 13 }, (_, i) => ({ id: `r${i}`, password: 'x' }));
    assert.equal((await ask(app, tooMany)).statusCode, 400);
    assert.equal((await app.inject({ method: 'POST', url: '/api/rooms/presence', payload: {} })).statusCode, 400);
  });
});
