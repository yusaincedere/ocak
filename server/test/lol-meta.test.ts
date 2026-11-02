import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';

const dir = mkdtempSync(join(tmpdir(), 'ocak-meta-'));
process.env.DB_PATH = join(dir, 'test.db');
process.env.WEB_DIST = '/nonexistent';
process.env.NODE_ENV = 'test';
const { buildApp } = await import('../src/app.js');
const { RiotClient } = await import('../src/lol/riot.js');
const { setStaticData } = await import('../src/lol/ddragon.js');
const { db } = await import('../src/db.js');
after(() => { db.close(); rmSync(dir, { recursive: true, force: true }); });

test('metadata distinguishes disabled configuration from data loading, then becomes ready', async () => {
  const disabled = await buildApp({ logger: false, rateLimits: false });
  const configured = await buildApp({ logger: false, rateLimits: false, riot: new RiotClient({ apiKey: 'test' }) });
  try {
    setStaticData(null);
    assert.deepEqual((await disabled.inject('/api/lol/meta')).json(), { enabled: false });
    assert.deepEqual((await configured.inject('/api/lol/meta')).json(), { enabled: false, loading: true });
    const champion = { id: 'Ahri', key: 103, name: { en_US: 'Ahri', tr_TR: 'Ahri' } };
    setStaticData({
      base: 'https://example.test', version: '16.1.1', patch: '16.1',
      champions: new Map([[103, champion]]), championsById: new Map([['ahri', champion]]),
      items: new Map(), runes: new Map(), spells: new Map(),
    });
    const ready = (await configured.inject('/api/lol/meta')).json();
    assert.equal(ready.enabled, true);
    assert.equal(ready.loading, undefined);
    assert.equal(ready.champions[0].id, 'Ahri');
    assert.deepEqual(ready.champions[0].roles, ['MIDDLE']); // Works on an empty database.
  } finally {
    setStaticData(null);
    await configured.close();
    await disabled.close();
  }
});
