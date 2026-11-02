import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { closeThread, receiveInThread, showThread, toggleThread, type Threads } from '../src/threads';

const none: Threads = {};

describe('private chats', () => {
  test('opening someone brings their conversation up, ready to read', () => {
    const t = showThread(none, 'kerem', 'Kerem');
    assert.deepEqual(
      { open: t.kerem!.open, collapsed: t.kerem!.collapsed, unread: t.kerem!.unread },
      { open: true, collapsed: false, unread: 0 },
    );
  });

  test('only one conversation is expanded at a time', () => {
    const t = showThread(showThread(none, 'kerem', 'Kerem'), 'mert', 'Mert');
    assert.equal(t.kerem!.open, true);
    assert.equal(t.kerem!.collapsed, true);
    assert.equal(t.mert!.collapsed, false);
  });

  test('a message from someone new arrives as a collapsed bar with a count', () => {
    const t = receiveInThread(none, 'kerem', 'Kerem');
    assert.deepEqual(
      { open: t.kerem!.open, collapsed: t.kerem!.collapsed, unread: t.kerem!.unread },
      { open: true, collapsed: true, unread: 1 },
    );
  });

  test('a message does not take over the conversation you are reading', () => {
    const reading = showThread(none, 'kerem', 'Kerem');
    const t = receiveInThread(reading, 'mert', 'Mert');
    assert.equal(t.kerem!.collapsed, false);
    assert.equal(t.mert!.collapsed, true);
  });

  test('messages in the conversation you are reading are not counted', () => {
    const t = receiveInThread(showThread(none, 'kerem', 'Kerem'), 'kerem', 'Kerem');
    assert.equal(t.kerem!.unread, 0);
  });

  test('a closed conversation comes back when they write again, and keeps counting', () => {
    let t = closeThread(showThread(none, 'kerem', 'Kerem'), 'kerem');
    assert.equal(t.kerem!.open, false);
    t = receiveInThread(receiveInThread(t, 'kerem', 'Kerem'), 'kerem', 'Kerem');
    assert.equal(t.kerem!.open, true);
    assert.equal(t.kerem!.unread, 2);
  });

  test('expanding clears the count, collapsing keeps the conversation open', () => {
    let t = receiveInThread(none, 'kerem', 'Kerem');
    t = toggleThread(t, 'kerem');
    assert.deepEqual({ collapsed: t.kerem!.collapsed, unread: t.kerem!.unread }, { collapsed: false, unread: 0 });
    t = toggleThread(t, 'kerem');
    assert.deepEqual({ open: t.kerem!.open, collapsed: t.kerem!.collapsed }, { open: true, collapsed: true });
  });

  test('a new display name replaces the old one', () => {
    const t = receiveInThread(showThread(none, 'kerem', 'Kerem'), 'kerem', 'Kerem2');
    assert.equal(t.kerem!.name, 'Kerem2');
  });
});
