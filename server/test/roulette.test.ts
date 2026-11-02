import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';

const dir = mkdtempSync(join(tmpdir(), 'ocak-roulette-'));
process.env.DB_PATH = join(dir, 'roulette.db');
process.env.NODE_ENV = 'test';
const { rouletteRoles } = await import('../src/lol/stats.js');
const { db } = await import('../src/db.js');
after(() => { db.close(); rmSync(dir, { recursive: true, force: true }); });

test('lane pools exclude old patches, other ranks, isolated off-role games and sparse data', () => {
  assert.equal(rouletteRoles(['PLATINUM']).size, 0);
  const add = db.prepare('INSERT INTO lol_champ (patch, tier, champ, role, games, wins) VALUES (?, ?, ?, ?, ?, 0)');
  add.run('16.1', 'PLATINUM', 103, 'TOP', 100);
  add.run('16.2', 'PLATINUM', 103, 'MIDDLE', 40);
  add.run('16.3', 'PLATINUM', 103, 'MIDDLE', 60);
  add.run('16.3', 'PLATINUM', 103, 'UTILITY', 2);
  add.run('16.3', 'PLATINUM', 99, 'UTILITY', 8);
  add.run('16.3', 'PLATINUM', 17, 'TOP', 1);
  add.run('16.3', 'GOLD', 103, 'JUNGLE', 100);
  const lanes = rouletteRoles(['PLATINUM']);
  assert.deepEqual(lanes.get(103), ['MIDDLE']);
  assert.deepEqual(lanes.get(99), ['UTILITY']);
  assert.equal(lanes.has(17), false);
  assert.deepEqual(rouletteRoles(['GOLD']).get(103), ['JUNGLE']);
});
