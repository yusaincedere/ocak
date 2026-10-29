import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assignColors, colorFor, resetColors } from '../src/presence';

// Device ids whose usual color is the same (found by trying), to force a clash.
function clashing(n: number): string[] {
  resetColors();
  const byColor = new Map<string, string[]>();
  for (let i = 0; ; i++) {
    const id = `dev${i}`;
    const c = colorFor(`${id}:x`);
    const list = [...(byColor.get(c) ?? []), id];
    byColor.set(c, list);
    if (list.length === n) return list;
  }
}

test('people in a call never share a color, even when their usual colors clash', () => {
  const ids = clashing(3).map((d) => `${d}:abc`);
  assignColors(ids);
  assert.equal(new Set(ids.map(colorFor)).size, 3);
});

test('every screen comes to the same colors, whatever order people are listed in', () => {
  const ids = [...clashing(3), 'zz', 'aa', 'mm'].map((d) => `${d}:s`);
  resetColors();
  assignColors(ids);
  const first = ids.map(colorFor);
  resetColors();
  assignColors([...ids].reverse());
  assert.deepEqual(ids.map(colorFor), first);
});

test('someone who left keeps their color for their old chat messages', () => {
  const [a, b] = clashing(2).map((d) => `${d}:1`);
  resetColors();
  assignColors([a!, b!]);
  const bColor = colorFor(b!);
  assignColors([a!]);
  assert.equal(colorFor(b!), bColor);
});
