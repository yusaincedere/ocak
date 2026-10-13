import { ScreenSharePresets, VideoPresets, type RoomOptions, type ScreenShareCaptureOptions } from 'livekit-client';
import { api } from './api';
import { translate } from './i18n';
import { deviceId, getCreateCode, rememberRoom } from './identity';
import { roomLink } from './links';
import { useStore } from './store';

/** Room settings shared by every call. Must be a stable object (LiveKitRoom compares by reference). */
export const roomOptions: RoomOptions = {
  adaptiveStream: true, // only download video at the size it's actually displayed
  dynacast: true, // stop encoding layers nobody is watching
  audioCaptureDefaults: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  videoCaptureDefaults: { resolution: VideoPresets.h720.resolution },
  publishDefaults: {
    simulcast: true,
    screenShareEncoding: ScreenSharePresets.h1080fps30.encoding,
    dtx: true,
    red: true,
  },
};

export const screenShareOptions: ScreenShareCaptureOptions = {
  audio: true, // tab / system audio where the browser supports it
  systemAudio: 'include',
  selfBrowserSurface: 'exclude',
  surfaceSwitching: 'include',
  resolution: ScreenSharePresets.h1080fps30.resolution,
};

/** Create a new room and join it. Throws ApiError (code 'create_code' if the server code is needed). */
export async function startCall(createCode = getCreateCode()) {
  const room = await api.createRoom(createCode);
  await joinCall(room.id, room.password);
}

/** Join a room by ID + password. Throws ApiError on a wrong password / unknown room. */
export async function joinCall(roomId: string, password: string) {
  const name = useStore.getState().name;
  if (!name) throw new Error(translate('error.pickName'));
  const res = await api.joinRoom(roomId, { password, name, deviceId: deviceId() });
  rememberRoom(res.roomId, password);
  // Put the invite link in the address bar so a refresh rejoins and copying the URL works.
  history.replaceState(null, '', new URL(roomLink(res.roomId, password)).pathname + `#${password}`);
  useStore.getState().setCall({ roomId: res.roomId, password, url: res.url, token: res.token });
}

export function leaveCall() {
  useStore.getState().setCall(null);
  history.replaceState(null, '', '/');
}
