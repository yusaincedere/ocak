import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomIndex, roulettePool, rouletteSpin, type RouletteChampion } from '../src/roulette.ts';

const champions: RouletteChampion[] = [
  { id: 'Ahri', name: 'Ahri', key: 103, roles: ['MIDDLE'] },
  { id: 'Lux', name: 'Lux', key: 99, roles: ['MIDDLE', 'UTILITY'] },
  { id: 'Teemo', name: 'Teemo', key: 17 },
];

test('any lane uses the full roster; a specific lane uses only eligible champions', () => {
  assert.equal(roulettePool(champions, '').length, 3);
  assert.deepEqual(roulettePool(champions, 'UTILITY').map((c) => c.id), ['Lux']);
  assert.deepEqual(roulettePool(champions, 'TOP'), []);
  assert.equal(roulettePool([...champions, champions[0]!], '').length, 3);
});

test('the selected champion lands in the marked reel slot', () => {
  const spin = rouletteSpin(champions, (size) => size - 1)!;
  assert.equal(spin.winner.id, 'Teemo');
  assert.equal(spin.reel[spin.stop], spin.winner);
  assert.ok(spin.reel.length > spin.stop + 1);
  assert.ok(spin.reel.every((c) => champions.includes(c)));
  assert.equal(rouletteSpin([]), null);
});

test('random selection rejects the biased remainder instead of favoring an index', () => {
  const values = [0xffffffff, 4];
  assert.equal(randomIndex(3, () => values.shift()!), 1);
  assert.equal(values.length, 0);
  assert.equal(randomIndex(1, () => 0xffffffff), 0);
  assert.throws(() => randomIndex(0), RangeError);
});
