// Everything about "you" lives in this browser / desktop app. No accounts.
// If local storage is cleared you just pick your name again.

const KEY = {
  device: 'ocak.device',
  name: 'ocak.name',
  rooms: 'ocak.rooms',
  createCode: 'ocak.createCode',
};

const memory = new Map<string, string>(); // fallback when storage is blocked (private mode etc.)

function read(key: string): string | null {
  try {
    return localStorage.getItem(key) ?? memory.get(key) ?? null;
  } catch {
    return memory.get(key) ?? null;
  }
}

function write(key: string, value: string | null) {
  if (value === null) memory.delete(key);
  else memory.set(key, value);
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* memory only */
  }
}

/** Random, stable per device. Lets the server tell two "Mert"s apart; never shown. */
export function deviceId(): string {
  let id = read(KEY.device);
  if (!id) {
    const bytes = crypto.getRandomValues(new Uint8Array(12));
    id = Array.from(bytes, (b) => b.toString(36).padStart(2, '0')).join('').slice(0, 20);
    write(KEY.device, id);
  }
  return id;
}

export const getName = () => read(KEY.name);
export const setName = (name: string) => write(KEY.name, name.trim().slice(0, 32));

export const getCreateCode = () => read(KEY.createCode);
export const setCreateCode = (code: string | null) => write(KEY.createCode, code);

export interface RecentRoom {
  id: string;
  password: string;
  lastUsed: number;
}

export function recentRooms(): RecentRoom[] {
  try {
    const list = JSON.parse(read(KEY.rooms) ?? '[]') as RecentRoom[];
    return Array.isArray(list) ? list.filter((r) => r && typeof r.id === 'string') : [];
  } catch {
    return [];
  }
}

export function rememberRoom(id: string, password: string) {
  const rest = recentRooms().filter((r) => r.id !== id);
  write(KEY.rooms, JSON.stringify([{ id, password, lastUsed: Date.now() }, ...rest].slice(0, 6)));
}

export function forgetRoom(id: string) {
  write(KEY.rooms, JSON.stringify(recentRooms().filter((r) => r.id !== id)));
}
