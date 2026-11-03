import assert from 'node:assert/strict';
import { test } from 'node:test';
import { personState } from '../src/presence';

const nobody = { deafened: false, micOff: false, silencedForMe: false, ptt: false };

test('someone with nothing special going on shows nothing', () => {
  assert.deepEqual(personState(nobody), []);
});

test('deafened and muted mic are both visible', () => {
  assert.deepEqual(personState({ ...nobody, deafened: true, micOff: true }), ['micOff', 'deafened']);
});

test('a muted mic wins over being turned down for you', () => {
  assert.deepEqual(personState({ ...nobody, micOff: true, silencedForMe: true }), ['micOff']);
});

test('turning a push-to-talk user down shows that rather than push-to-talk', () => {
  assert.deepEqual(personState({ ...nobody, silencedForMe: true, ptt: true }), ['silenced']);
  assert.deepEqual(personState({ ...nobody, ptt: true }), ['ptt']);
});
