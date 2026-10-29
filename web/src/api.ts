import type {
  CreatedRoom,
  Gender,
  JoinResult,
  LolBuild,
  LolLang,
  LolTier,
  LolMatchSummary,
  LolMeta,
  RandomAvatar,
  ServerConfig,
} from '../../server/src/protocol';
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

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers: body === undefined ? {} : { 'content-type': 'application/json' },
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
  randomAvatar: (gender: Gender) => request<RandomAvatar>('POST', '/api/avatars/random', { gender }),

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
