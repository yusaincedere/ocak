import { app } from 'electron';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DesktopSettings, HotkeyBinding } from '../../web/src/desktop-bridge';

const file = () => join(app.getPath('userData'), 'settings.json');

/** Server URL baked in at build time (package.json "ocak.serverUrl") or given via OCAK_SERVER_URL. */
function defaultServerUrl(): string {
  if (process.env.OCAK_SERVER_URL) return process.env.OCAK_SERVER_URL;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pkg = require(join(app.getAppPath(), 'package.json')) as { ocak?: { serverUrl?: string } };
    return pkg.ocak?.serverUrl ?? '';
  } catch {
    return '';
  }
}

const defaults = (): DesktopSettings => ({
  serverUrl: defaultServerUrl(),
  pushToTalk: false,
  pttBinding: null,
  muteShortcut: 'CommandOrControl+Shift+M',
  closeToTray: true,
  overlay: true,
  language: 'tr',
});

let current: DesktopSettings | null = null;

export function getSettings(): DesktopSettings {
  if (current) return current;
  let saved: Partial<DesktopSettings> = {};
  try {
    saved = JSON.parse(readFileSync(file(), 'utf8'));
  } catch {
    /* first run */
  }
  current = { ...defaults(), ...sanitize(saved) };
  // An env override always wins (handy for development).
  if (process.env.OCAK_SERVER_URL) current.serverUrl = process.env.OCAK_SERVER_URL;
  return current;
}

export function updateSettings(patch: unknown): DesktopSettings {
  current = { ...getSettings(), ...sanitize(patch) };
  try {
    writeFileSync(file(), JSON.stringify(current, null, 2));
  } catch (err) {
    console.error('Could not save settings', err);
  }
  return current;
}

/** Only accept well-formed values from the renderer. */
function sanitize(input: unknown): Partial<DesktopSettings> {
  if (!input || typeof input !== 'object') return {};
  const p = input as Record<string, unknown>;
  const out: Partial<DesktopSettings> = {};

  if (typeof p.serverUrl === 'string') {
    const url = normalizeServerUrl(p.serverUrl);
    if (url !== null) out.serverUrl = url;
  }
  if (typeof p.pushToTalk === 'boolean') out.pushToTalk = p.pushToTalk;
  if (typeof p.closeToTray === 'boolean') out.closeToTray = p.closeToTray;
  if (typeof p.overlay === 'boolean') out.overlay = p.overlay;
  if (p.language === 'tr' || p.language === 'en') out.language = p.language;
  if (typeof p.muteShortcut === 'string' && p.muteShortcut.length <= 60) out.muteShortcut = p.muteShortcut;
  if (p.pttBinding === null) out.pttBinding = null;
  else if (isBinding(p.pttBinding)) out.pttBinding = p.pttBinding;
  return out;
}

function isBinding(v: unknown): v is HotkeyBinding {
  if (!v || typeof v !== 'object') return false;
  const b = v as Record<string, unknown>;
  return (
    (b.kind === 'key' || b.kind === 'mouse') &&
    typeof b.code === 'number' &&
    Number.isInteger(b.code) &&
    typeof b.label === 'string' &&
    b.label.length < 40
  );
}

/**
 * Returns the origin-only URL (e.g. "https://chat.example.com"), or null if invalid.
 * Plain http is only allowed for local development.
 */
export function normalizeServerUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  try {
    const u = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
    if (u.protocol !== 'https:' && !(u.protocol === 'http:' && local)) return null;
    return u.origin;
  } catch {
    return null;
  }
}
