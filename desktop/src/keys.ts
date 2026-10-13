// Pure key-mapping logic for remote control (no Electron imports, so it can be unit tested).
import type { ControlInput } from '../../web/src/desktop-bridge';

/**
 * Decide how to reproduce one key press on this computer:
 * text is typed as characters (so it works across keyboard layouts, e.g. Turkish ç ş ğ),
 * shortcuts and special keys are tapped with their modifiers.
 */
export function planKey(
  k: Extract<ControlInput, { t: 'key' }>,
): { type: 'type'; text: string } | { type: 'tap'; key: string; mods: string[] } | null {
  if (!k.down || MODIFIER_CODES.has(k.code)) return null;
  const altGr = k.ctrl && k.alt; // Windows reports AltGr as Ctrl+Alt
  const printable = [...k.key].length === 1 && !k.meta && (!k.ctrl || altGr);
  if (printable) return { type: 'type', text: k.key };
  const key = KEY_NAMES[k.code];
  if (!key) return null;
  const mods: string[] = [];
  if (k.shift) mods.push('shift');
  if (k.ctrl && !altGr) mods.push('control');
  if (k.alt && !altGr) mods.push('alt');
  if (k.meta) mods.push('command');
  return { type: 'tap', key, mods };
}

const MODIFIER_CODES = new Set([
  'ShiftLeft',
  'ShiftRight',
  'ControlLeft',
  'ControlRight',
  'AltLeft',
  'AltRight',
  'MetaLeft',
  'MetaRight',
  'CapsLock',
]);

/** KeyboardEvent.code → robotjs key name (for shortcuts and non-text keys). */
const KEY_NAMES: Record<string, string> = {
  Enter: 'enter',
  NumpadEnter: 'enter',
  Backspace: 'backspace',
  Tab: 'tab',
  Escape: 'escape',
  Space: 'space',
  Delete: 'delete',
  Insert: 'insert',
  Home: 'home',
  End: 'end',
  PageUp: 'pageup',
  PageDown: 'pagedown',
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  Comma: ',',
  Period: '.',
  Slash: '/',
  Backquote: '`',
};
for (let i = 0; i < 26; i++) {
  const c = String.fromCharCode(97 + i);
  KEY_NAMES[`Key${c.toUpperCase()}`] = c;
}
for (let i = 0; i <= 9; i++) {
  KEY_NAMES[`Digit${i}`] = String(i);
  KEY_NAMES[`Numpad${i}`] = `numpad_${i}`;
}
for (let i = 1; i <= 12; i++) KEY_NAMES[`F${i}`] = `f${i}`;
