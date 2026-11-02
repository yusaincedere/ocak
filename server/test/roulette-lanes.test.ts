import assert from 'node:assert/strict';
import { test } from 'node:test';
import { rouletteLanes } from '../src/lol/roulette-lanes.js';

test('every lane has well-known champions without collecting any local matches', () => {
  assert.ok(rouletteLanes(86).includes('TOP')); // Garen
  assert.ok(rouletteLanes(64).includes('JUNGLE')); // Lee Sin
  assert.ok(rouletteLanes(103).includes('MIDDLE')); // Ahri
  assert.ok(rouletteLanes(222).includes('BOTTOM')); // Jinx
  assert.ok(rouletteLanes(412).includes('UTILITY')); // Thresh
});

test('observed lanes extend and deduplicate the baseline instead of erasing known positions', () => {
  assert.deepEqual(rouletteLanes(103, ['MIDDLE', 'TOP']), ['MIDDLE', 'TOP']);
  assert.deepEqual(rouletteLanes(999999), []);
  assert.deepEqual(rouletteLanes(999999, ['UTILITY']), ['UTILITY']);
  assert.ok(rouletteLanes(99).includes('MIDDLE'));
  assert.ok(rouletteLanes(99).includes('UTILITY'));
});
