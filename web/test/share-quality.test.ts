import assert from 'node:assert/strict';
import test from 'node:test';
import { shareSettings } from '../src/share-quality.ts';

test('smooth sharing requests and publishes 60 fps', () => {
  const { capture, publish } = shareSettings('smooth');
  assert.equal(capture.resolution?.frameRate, 60);
  assert.equal(publish.screenShareEncoding?.maxFramerate, 60);
  assert.equal(publish.degradationPreference, 'maintain-framerate');
});

test('original sharing bypasses the SDK capture cap while retaining a 30 fps publish limit', () => {
  const { capture, publish } = shareSettings('original');
  assert.equal(capture.resolution?.width, 0);
  assert.equal(capture.resolution?.height, 0);
  assert.equal(publish.screenShareEncoding?.maxFramerate, 30);
});

test('4K mode requests 2160p60 with enough publishing headroom', () => {
  const { capture, publish } = shareSettings('ultra');
  assert.equal(capture.resolution?.width, 3840);
  assert.equal(capture.resolution?.height, 2160);
  assert.equal(capture.resolution?.frameRate, 60);
  assert.equal(publish.screenShareEncoding?.maxFramerate, 60);
  assert.equal(publish.screenShareEncoding?.maxBitrate, 20_000_000);
});
