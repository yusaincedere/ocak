import assert from 'node:assert/strict';
import { test } from 'node:test';
import { overlayPreference } from '../src/overlay-preference.ts';

test('overlay is off for first use and legacy automatic-on settings', () => {
  for (const saved of [undefined, null, {}, { overlay: true }, { overlay: false }]) {
    assert.equal(overlayPreference(saved), false);
  }
});

test('only a saved explicit opt-in enables the overlay', () => {
  assert.equal(overlayPreference({ overlay: true, overlayPreferenceVersion: 1 }), true);
  assert.equal(overlayPreference({ overlay: false, overlayPreferenceVersion: 1 }), false);
  assert.equal(overlayPreference({ overlay: 'true', overlayPreferenceVersion: 1 }), false);
});
