import type {
  AdminRooms,
  CreatedRoom,
  Gender,
  JoinResult,
  LolBuild,
  LolLang,
  LolTier,
  LolMatchSummary,
  LolMeta,
  RandomAvatar,
  RoomsPresence,
  SavedMessage,
  ServerConfig,
} from '../../server/src/protocol';
import { getAdminKey } from './identity';
import { translate, type MessageKey } from './i18n';

/** Server error codes → translated messages (the server's own text is English-only). */
const ERROR_KEYS: Record<string, MessageKey> = {
  create_code: 'error.wrongCode',
  password: 'error.wrongPassword',
  not_found: 'error.notFound',
  avatar_failed: 'avatar.failed',
  no_data: 'lol.noData',
  riot_id: 'lol.badRiotId',
  riot_key: 'lol.riotDown',
  riot_busy: 'lol.riotBusy',
  riot_down: 'lol.riotDown',
  no_avatars: 'avatar.failed',
  admin_key: 'admin.wrongKey',
  admin_off: 'admin.off',
  not_in_call: 'admin.notInCall',
};

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    /** machine-readable reason: 'create_code' | 'password' | 'not_found' | ... */
    public code?: string,
  ) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown, adminKey = getAdminKey(), extra: Record<string, string> = {}): Promise<T> {
  let res: Response;
  const headers: Record<string, string> = { ...extra };
  if (body !== undefined) headers['content-type'] = 'application/json';
  // The admin key rides along on every request once saved: joining a room then comes with admin powers.
  if (adminKey) headers['x-admin-key'] = adminKey;
  try {
    res = await fetch(path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, translate('error.offline'));
  }
  const data = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
  if (!res.ok) {
    const key: MessageKey | undefined =
      res.status === 429 ? 'error.tooMany' : data.code ? ERROR_KEYS[data.code] : res.status === 400 ? 'error.invalid' : undefined;
    const msg = key ? translate(key) : (data.error ?? translate('common.somethingWrong'));
    throw new ApiError(res.status, msg, data.code);
  }
  return data as T;
}

export const api = {
  config: () => request<ServerConfig>('GET', '/api/config'),
  /** The room gets a name in the UI language: "limon3" or "lemon3". */
  createRoom: (createCode?: string | null, lang?: 'tr' | 'en') =>
    request<CreatedRoom>('POST', '/api/rooms', { ...(createCode ? { createCode } : {}), lang }),
  joinRoom: (id: string, b: { password: string; name: string; deviceId: string }) =>
    request<JoinResult>('POST', `/api/rooms/${encodeURIComponent(id)}/join`, b),
  /** A room's saved group chat; the call token shows we're in that call. */
  chat: {
    load: (roomId: string, token: string) =>
      request<{ messages: SavedMessage[] }>('GET', `/api/rooms/${encodeURIComponent(roomId)}/messages`, undefined, undefined, { authorization: `Bearer ${token}` }),
    save: (roomId: string, token: string, m: { id: string; body: string; name?: string }) =>
      request<{ ok: true }>('POST', `/api/rooms/${encodeURIComponent(roomId)}/messages`, m, undefined, { authorization: `Bearer ${token}` }),
  },
  /** Who is in the calls of these rooms (only rooms whose password is right). */
  roomsPresence: (rooms: { id: string; password: string }[]) => request<RoomsPresence>('POST', '/api/rooms/presence', { rooms }),
  randomAvatar: (gender: Gender) => request<RandomAvatar>('POST', '/api/avatars/random', { gender }),

  admin: {
    /** Checks a key before it is saved. */
    check: (key: string) => request<{ ok: true }>('GET', '/api/admin/check', undefined, key),
    rooms: () => request<AdminRooms>('GET', '/api/admin/rooms'),
    join: (id: string, b: { name: string; deviceId: string }) =>
      request<JoinResult>('POST', `/api/admin/rooms/${encodeURIComponent(id)}/join`, b),
    newPassword: (id: string) => request<{ id: string; password: string }>('POST', `/api/admin/rooms/${encodeURIComponent(id)}/password`),
    endCall: (id: string) => request<{ ok: true }>('POST', `/api/admin/rooms/${encodeURIComponent(id)}/end`),
    deleteRoom: (id: string) => request<{ ok: true }>('DELETE', `/api/admin/rooms/${encodeURIComponent(id)}`),
    mute: (id: string, identity: string) =>
      request<{ ok: true }>('POST', `/api/admin/rooms/${encodeURIComponent(id)}/people/${encodeURIComponent(identity)}/mute`),
    kick: (id: string, identity: string) =>
      request<{ ok: true }>('POST', `/api/admin/rooms/${encodeURIComponent(id)}/people/${encodeURIComponent(identity)}/kick`),
  },

  lolMeta: (lang: LolLang, rank: LolTier) => request<LolMeta>('GET', `/api/lol/meta?lang=${lang}&rank=${rank}`),
  lolBuild: (champion: string, role: string | null, lang: LolLang, rank: LolTier) =>
    request<LolBuild>(
      'GET',
      `/api/lol/build/${encodeURIComponent(champion)}?lang=${lang}&rank=${rank}${role ? `&role=${role}` : ''}`,
    ),
  lolAccount: (riotId: string) => request<{ riotId: string }>('GET', `/api/lol/account/${encodeURIComponent(riotId)}`),
  lolLatest: (riotId: string, platform: string) =>
    request<{ matchId: string | null }>('GET', `/api/lol/latest/${encodeURIComponent(riotId)}?platform=${platform}`),
  lolMains: (riotId: string, platform: string, lang: LolLang) =>
    request<{ champions: { id: string; key: number; name: string }[] }>(
      'GET',
      `/api/lol/mains/${encodeURIComponent(riotId)}?platform=${platform}&lang=${lang}`,
    ),
  lolMatch: (id: string) => request<LolMatchSummary>('GET', `/api/lol/match/${encodeURIComponent(id)}`),
};
