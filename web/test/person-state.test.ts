import assert from 'node:assert/strict';
import { test } from 'node:test';
import { personState } from '../src/presence';

const nobody = { deafened: false, micOff: false, silencedForMe: false, ptt: false };

test('someone with nothing special going on shows nothing', () => {
  assert.equal(personState(nobody), null);
});

test('deafened wins over a muted mic, since deafening also mutes', () => {
  assert.equal(personState({ ...nobody, deafened: true, micOff: true }), 'deafened');
});

test('a muted mic wins over being turned down for you', () => {
  assert.equal(personState({ ...nobody, micOff: true, silencedForMe: true }), 'micOff');
});

test('turning a push-to-talk user down shows that rather than push-to-talk', () => {
  assert.equal(personState({ ...nobody, silencedForMe: true, ptt: true }), 'silenced');
  assert.equal(personState({ ...nobody, ptt: true }), 'ptt');
});
