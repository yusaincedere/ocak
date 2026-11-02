import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mediaErrorKey } from '../src/media-errors.ts';

test('browser and LiveKit failures select actionable localized messages', () => {
  for (const name of ['NotAllowedError', 'PermissionDeniedError', 'PermissionDenied', 'SecurityError']) {
    assert.equal(mediaErrorKey({ name }), 'call.permissionDenied', name);
  }
  for (const name of ['NotFoundError', 'DevicesNotFoundError', 'NotFound']) {
    assert.equal(mediaErrorKey({ name }), 'call.deviceMissing', name);
  }
  for (const name of ['NotReadableError', 'TrackStartError', 'DeviceInUse']) {
    assert.equal(mediaErrorKey({ name }), 'call.deviceBusy', name);
  }
});

test('unknown errors use localized fallback instead of leaking browser messages', () => {
  assert.equal(mediaErrorKey(new Error('Raw platform error')), 'call.failed');
});
