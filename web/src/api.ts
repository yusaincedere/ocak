import type { CreatedRoom, JoinResult, ServerConfig } from '../../server/src/protocol';

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
    throw new ApiError(0, "Can't reach the server. Check your connection.");
  }
  const data = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
  if (!res.ok) {
    const msg = res.status === 429 ? 'Too many attempts. Wait a minute and try again.' : (data.error ?? 'Something went wrong');
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
