import { ScreenSharePresets, VideoPresets, type RoomOptions } from 'livekit-client';
import { api } from './api';
import { translate } from './i18n';
import { deviceId, getCreateCode, rememberRoom } from './identity';
import { roomLink } from './links';
import { useStore } from './store';

/** Room settings shared by every call. Must be a stable object (LiveKitRoom compares by reference). */
export const roomOptions: RoomOptions = {
  adaptiveStream: true, // only download video at the size it's actually displayed
  dynacast: true, // stop encoding layers nobody is watching
  // Mix incoming audio through Web Audio, so per-friend volume can go above 100%.
  webAudioMix: true,
  audioCaptureDefaults: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  videoCaptureDefaults: { resolution: VideoPresets.h720.resolution },
  publishDefaults: {
    simulcast: true,
    screenShareEncoding: ScreenSharePresets.h1080fps30.encoding,
    dtx: true,
    red: true,
  },
};

/** Create a new room and join it. Throws ApiError (code 'create_code' if the server code is needed). */
export async function startCall(createCode = getCreateCode()) {
  const room = await api.createRoom(createCode, useStore.getState().lang);
  await joinCall(room.id, room.password);
}

/** Whether a call token carries LiveKit's room-admin grant (read from our own token only). */
function isAdminToken(token: string): boolean {
  try {
    const payload = JSON.parse(atob(token.split('.')[1]!.replace(/-/g, '+').replace(/_/g, '/'))) as { video?: { roomAdmin?: boolean } };
    return payload.video?.roomAdmin === true;
  } catch {
    return false;
  }
}

/** Join a room by ID + password. Throws ApiError on a wrong password / unknown room. */
export async function joinCall(roomId: string, password: string) {
  const name = useStore.getState().name;
  if (!name) throw new Error(translate('error.pickName'));
  const res = await api.joinRoom(roomId, { password, name, deviceId: deviceId() });
  rememberRoom(res.roomId, password);
  // Put the invite link in the address bar so a refresh rejoins and copying the URL works.
  history.replaceState(null, '', new URL(roomLink(res.roomId, password)).pathname + `#${password}`);
  useStore.getState().setCall({ roomId: res.roomId, password, url: res.url, token: res.token, admin: isAdminToken(res.token) });
}

/** Admins: join any room without its password. The invite link isn't known then, so it isn't shown. */
export async function joinCallAsAdmin(roomId: string) {
  const name = useStore.getState().name;
  if (!name) throw new Error(translate('error.pickName'));
  const res = await api.admin.join(roomId, { name, deviceId: deviceId() });
  history.replaceState(null, '', `/r/${res.roomId}`);
  useStore.getState().setCall({ roomId: res.roomId, password: null, url: res.url, token: res.token, admin: isAdminToken(res.token) });
}

/** Join again after a dropped connection, the same way as the first time. */
export const rejoinCall = (roomId: string, password: string | null) =>
  password === null ? joinCallAsAdmin(roomId) : joinCall(roomId, password);

export function leaveCall() {
  useStore.getState().setCall(null);
  history.replaceState(null, '', '/');
}
