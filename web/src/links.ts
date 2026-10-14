// Invite links look like  https://chat.example.com/r/limon3#h3x9tw
// (rooms made before word names look like /r/k7m2-qp4x and still work)
// The password sits after "#", so it never reaches the server or its logs.

export const roomLink = (id: string, password: string) => `${location.origin}/r/${id}#${password}`;

const WORD_ID = /^[a-z]{2,16}\d{1,4}$/;
const OLD_ID = /^[a-z0-9]{8}$/;

/**
 * Understands a pasted link, "/r/ID#pw", "ID", "ID pw", "ID#pw" or "limon 3 pw".
 * Returns null when it can't find a room ID.
 */
export function parseJoinInput(text: string): { id: string; password: string | null } | null {
  const t = text.trim();
  if (!t) return null;

  const fromPath = t.match(/\/r\/([a-z0-9-]+)(?:#([a-z0-9]+))?/i);
  if (fromPath) {
    const id = normalizeId(fromPath[1]!);
    return id ? { id, password: fromPath[2]?.toLowerCase() ?? null } : null;
  }

  const parts = t.split(/[\s#]+/);
  // "limon 3" typed with a space: the word and the number are one name.
  if (parts.length > 1 && /^\p{L}+$/u.test(parts[0]!) && /^\d+$/.test(parts[1]!)) parts.splice(0, 2, parts[0]! + parts[1]!);
  const [first, second] = parts;
  const id = normalizeId(first ?? '');
  if (!id) return null;
  return { id, password: second ? second.toLowerCase() : null };
}

/** "Limon3", "LİMON-3" → "limon3"; old "K7M2QP4X" → "k7m2-qp4x". The server accepts both shapes. */
function normalizeId(raw: string): string | null {
  const s = raw.replace(/[İı]/g, 'i').toLowerCase().replace(/[\s-]/g, '');
  if (WORD_ID.test(s)) return s;
  if (OLD_ID.test(s)) return `${s.slice(0, 4)}-${s.slice(4)}`;
  return null;
}

/** The room in the current URL, if the page was opened from an invite link. */
export function roomFromLocation(): { id: string; password: string | null } | null {
  if (!location.pathname.startsWith('/r/')) return null;
  return parseJoinInput(location.pathname + location.hash);
}
