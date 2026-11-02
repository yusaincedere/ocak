import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { EMOJI_GROUPS, MAX_RECENT_EMOJI, pushRecentEmoji } from '../src/emoji';

describe('emoji picker', () => {
  test('no emoji appears twice', () => {
    const all = EMOJI_GROUPS.flatMap((g) => g.emojis);
    assert.equal(new Set(all).size, all.length);
  });

  test('the latest one comes first and repeats move up instead of doubling', () => {
    assert.deepEqual(pushRecentEmoji(['🔥', '💀'], '💀'), ['💀', '🔥']);
    assert.deepEqual(pushRecentEmoji(['🔥'], '👍'), ['👍', '🔥']);
  });

  test('the list stays short', () => {
    let recent: string[] = [];
    for (const emoji of EMOJI_GROUPS.flatMap((g) => g.emojis)) recent = pushRecentEmoji(recent, emoji);
    assert.equal(recent.length, MAX_RECENT_EMOJI);
  });
});
