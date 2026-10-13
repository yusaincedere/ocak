import type { CreatedRoom, JoinResult, ServerConfig } from '../../server/src/protocol';
import { translate, type MessageKey } from './i18n';

/** Server error codes → translated messages (the server's own text is English-only). */
const ERROR_KEYS: Record<string, MessageKey> = {
  create_code: 'error.wrongCode',
  password: 'error.wrongPassword',
  not_found: 'error.notFound',
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
  createRoom: (createCode?: string | null) =>
    request<CreatedRoom>('POST', '/api/rooms', createCode ? { createCode } : {}),
  joinRoom: (id: string, b: { password: string; name: string; deviceId: string }) =>
    request<JoinResult>('POST', `/api/rooms/${encodeURIComponent(id)}/join`, b),
};
