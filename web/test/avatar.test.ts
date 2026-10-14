import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { clampPick, cropStyle, defaultPick, dragPick, parsePick, serializePick } from '../src/avatar.ts';

const SRC = '/api/avatars/aHR0cHM6Ly9hLmV4YW1wbGUvMS5wbmc.abcdefghijklmnopqrstuv';
const pct = (v: unknown) => Number(String(v).replace('%', ''));

describe('profile picture crop', () => {
  test('starts near the top of portrait pictures, centred', () => {
    const a = defaultPick(SRC, 1094 / 1825);
    assert.equal(a.x, 0.5);
    assert.ok(a.y > 0.1 && a.y < 0.35, `y=${a.y}`);
  });

  test('the circle never leaves the picture', () => {
    const a = clampPick({ src: SRC, ar: 0.6, x: -3, y: 9, zoom: 0.5 });
    const style = cropStyle(a);
    // image edges stay outside (or on) the frame edges
    assert.ok(pct(style.left) <= 0.0001 && pct(style.top) <= 0.0001);
    assert.ok(pct(style.left) + pct(style.width) >= 99.999);
    assert.ok(pct(style.top) + pct(style.height) >= 99.999);
  });

  test('zoom is limited and a full zoom-out shows the whole short side', () => {
    assert.equal(clampPick({ src: SRC, ar: 0.6, x: 0.5, y: 0.5, zoom: 5 }).zoom, 1);
    const tiny = clampPick({ src: SRC, ar: 0.6, x: 0.5, y: 0.5, zoom: 0.001 });
    assert.ok(tiny.zoom >= 0.12);
    const whole = cropStyle({ src: SRC, ar: 0.6, x: 0.5, y: 0.5, zoom: 1 });
    assert.equal(pct(whole.width), 100); // picture exactly as wide as the circle
  });

  test('dragging right moves the picture right (shows more of its left side)', () => {
    const a = defaultPick(SRC, 1);
    const moved = dragPick({ ...a, zoom: 0.5 }, 20, 0, 200);
    assert.ok(moved.x < 0.5);
  });

  test('round-trips and rejects anything that is not one of our pictures', () => {
    const a = defaultPick(SRC, 0.6);
    assert.deepEqual(parsePick(serializePick(a))?.src, SRC);
    for (const bad of [
      '',
      'nonsense',
      JSON.stringify({ ...a, src: 'https://tracker.example/pixel.png' }),
      JSON.stringify({ ...a, src: '/api/avatars/../../etc' }),
      JSON.stringify({ ...a, ar: 'wide' }),
      JSON.stringify({ ...a, x: 7 }),
    ]) {
      assert.equal(parsePick(bad), null, bad);
    }
  });
});
