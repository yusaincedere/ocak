import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';

// Read the JSON directly so this test doesn't pull in the app's store (which needs a browser).
const load = (lang: string) =>
  JSON.parse(readFileSync(new URL(`../src/locales/${lang}.json`, import.meta.url), 'utf8')) as Record<string, string>;
const tr = load('tr');
const en = load('en');
const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe('locales', () => {
  test('Turkish and English have the same keys', () => {
    assert.deepEqual(Object.keys(en).sort(), Object.keys(tr).sort());
  });

  test('every translation keeps the same {placeholders}', () => {
    for (const key of Object.keys(tr)) assert.deepEqual(placeholders(en[key]!), placeholders(tr[key]!), key);
  });

  test('no empty strings', () => {
    for (const [key, value] of [...Object.entries(tr), ...Object.entries(en)]) assert.ok(value.trim(), key);
  });
});
