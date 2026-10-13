// Invite links look like  https://chat.example.com/r/k7m2-qp4x#h3x9tw
// The password sits after "#", so it never reaches the server or its logs.

export const roomLink = (id: string, password: string) => `${location.origin}/r/${id}#${password}`;

const ID_RE = /([a-z0-9]{4})-?([a-z0-9]{4})/i;

/**
 * Understands a pasted link, "/r/ID#pw", "ID", "ID pw" or "ID#pw".
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

  const [first, second] = t.split(/[\s#]+/);
  const id = normalizeId(first ?? '');
  if (!id) return null;
  return { id, password: second ? second.toLowerCase() : null };
}

function normalizeId(raw: string): string | null {
  const m = raw.replace(/\s/g, '').match(ID_RE);
  if (!m || raw.replace(/[^a-z0-9]/gi, '').length !== 8) return null;
  return `${m[1]}-${m[2]}`.toLowerCase();
}

/** The room in the current URL, if the page was opened from an invite link. */
export function roomFromLocation(): { id: string; password: string | null } | null {
  if (!location.pathname.startsWith('/r/')) return null;
  return parseJoinInput(location.pathname + location.hash);
}
