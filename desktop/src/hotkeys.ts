import type { HotkeyBinding } from '../../web/src/desktop-bridge';

// uiohook-napi gives us system-wide key/mouse *down and up* events, which Electron's
// globalShortcut can't (it only fires on press). Needed for real push-to-talk.
// It's a native module, so load it lazily and degrade gracefully if it's missing.
type UiohookModule = typeof import('uiohook-napi');
let mod: UiohookModule | null | undefined;

function load(): UiohookModule | null {
  if (mod !== undefined) return mod;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    mod = require('uiohook-napi') as UiohookModule;
  } catch (err) {
    console.error('Push-to-talk unavailable: could not load uiohook-napi', err);
    mod = null;
  }
  return mod;
}

const MOUSE_LABELS: Record<number, string> = { 3: 'Middle mouse', 4: 'Mouse 4', 5: 'Mouse 5' };

function keyLabel(code: number): string {
  const m = load();
  if (!m) return `Key ${code}`;
  const name = Object.entries(m.UiohookKey).find(([, v]) => v === code)?.[0];
  if (!name) return `Key ${code}`;
  // "CapsLock" -> "Caps Lock", "Ctrl" stays
  return name.replace(/([a-z])([A-Z0-9])/g, '$1 $2');
}

export class Hotkeys {
  private running = false;
  private binding: HotkeyBinding | null = null;
  private pressed = false;
  private capture: ((b: HotkeyBinding | null) => void) | null = null;

  constructor(private onPtt: (down: boolean) => void) {}

  get available() {
    return load() !== null;
  }

  setBinding(binding: HotkeyBinding | null) {
    if (this.pressed) this.onPtt(false);
    this.pressed = false;
    this.binding = binding;
    this.sync();
  }

  /** Resolve with the next key / non-primary mouse button pressed anywhere. Esc cancels. */
  captureNext(timeoutMs = 10_000): Promise<HotkeyBinding | null> {
    if (!load()) return Promise.resolve(null);
    this.capture?.(null);
    return new Promise((resolve) => {
      const timer = setTimeout(() => finish(null), timeoutMs);
      const finish = (b: HotkeyBinding | null) => {
        clearTimeout(timer);
        this.capture = null;
        setImmediate(() => this.sync()); // don't stop the hook from inside its own callback
        resolve(b);
      };
      this.capture = finish;
      this.sync();
    });
  }

  stop() {
    const m = load();
    if (m && this.running) m.uIOhook.stop();
    this.running = false;
  }

  /** Run the hook only while something needs it (macOS asks for Accessibility permission). */
  private sync() {
    const m = load();
    if (!m) return;
    const needed = !!this.binding || !!this.capture;
    if (needed && !this.running) {
      m.uIOhook.removeAllListeners();
      m.uIOhook.on('keydown', (e) => this.handle('key', e.keycode, true));
      m.uIOhook.on('keyup', (e) => this.handle('key', e.keycode, false));
      m.uIOhook.on('mousedown', (e) => this.handle('mouse', Number(e.button), true));
      m.uIOhook.on('mouseup', (e) => this.handle('mouse', Number(e.button), false));
      m.uIOhook.start();
      this.running = true;
    } else if (!needed && this.running) {
      this.stop();
    }
  }

  private handle(kind: 'key' | 'mouse', code: number, down: boolean) {
    if (this.capture) {
      if (!down) return;
      if (kind === 'mouse' && code < 3) return; // never bind left/right click
      const m = load()!;
      if (kind === 'key' && code === m.UiohookKey.Escape) return this.capture(null);
      const label = kind === 'mouse' ? (MOUSE_LABELS[code] ?? `Mouse ${code}`) : keyLabel(code);
      return this.capture({ kind, code, label });
    }
    const b = this.binding;
    if (!b || b.kind !== kind || b.code !== code) return;
    if (down === this.pressed) return; // ignore key repeat
    this.pressed = down;
    this.onPtt(down);
  }
}
