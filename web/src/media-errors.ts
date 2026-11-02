/** Map browser and LiveKit device failures without displaying browser-specific English text. */
export function mediaErrorKey(error: { name: string }) {
  switch (error.name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
    case 'PermissionDenied':
    case 'SecurityError':
      return 'call.permissionDenied';
    case 'NotFoundError':
    case 'DevicesNotFoundError':
    case 'NotFound':
      return 'call.deviceMissing';
    case 'NotReadableError':
    case 'TrackStartError':
    case 'DeviceInUse':
      return 'call.deviceBusy';
    default:
      return 'call.failed';
  }
}
