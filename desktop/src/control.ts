import { BrowserWindow, dialog, globalShortcut, ipcMain, screen, systemPreferences, type Display } from 'electron';
import { join } from 'node:path';
import type { ControlEndReason, ControlInput } from '../../web/src/desktop-bridge';
import { t } from './i18n';
import { planKey } from './keys';
import { getSettings } from './settings';

// @jitsi/robotjs moves the real mouse and presses real keys. It's a native module
// (prebuilt for Windows/macOS/Linux), loaded lazily so the app still runs without it.
type Robot = typeof import('@jitsi/robotjs');
let robot: Robot | null | undefined;
function loadRobot(): Robot | null {
  if (robot !== undefined) return robot;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    robot = require('@jitsi/robotjs') as Robot;
    robot.setMouseDelay(0);
    robot.setKeyboardDelay(0);
  } catch (err) {
    console.error('Remote control unavailable: could not load @jitsi/robotjs', err);
    robot = null;
  }
  return robot;
}

export const STOP_SHORTCUT = 'CommandOrControl+Shift+X';
const ASK_TIMEOUT_MS = 45_000;

interface Share {
  kind: 'screen' | 'window';
  displayId: string | null;
}

interface Session {
  controllerId: string;
  name: string;
  until: number | null;
  display: Display;
  timer: ReturnType<typeof setTimeout> | null;
  buttons: Set<'left' | 'right' | 'middle'>;
}

/**
 * Lets one person in the call control this computer while it shares a whole screen.
 * Consent is a native dialog shown here (not by the web page), and the session can
 * always be ended with the red banner's Stop button or the global shortcut.
 */
export class RemoteControl {
  private share: Share | null = null;
  private session: Session | null = null;
  private banner: BrowserWindow | null = null;

  constructor(
    private appRoot: string,
    private getWindow: () => BrowserWindow | null,
    private onEnded: (reason: ControlEndReason) => void,
  ) {
    ipcMain.on('ocak-banner:stop', (e) => {
      if (this.banner && !this.banner.isDestroyed() && e.sender === this.banner.webContents) this.end('stopped');
    });
  }

  get shareKind() {
    return this.share?.kind ?? null;
  }

  /** Called when the user picks what to share in the screen picker. */
  setShare(sourceId: string, displayId: string | null) {
    if (this.session) this.end('share-ended');
    this.share = { kind: sourceId.startsWith('screen:') ? 'screen' : 'window', displayId };
  }

  shareStopped() {
    this.share = null;
    if (this.session) this.end('share-ended');
  }

  async confirm(controllerId: string, name: string): Promise<{ allow: boolean; until: number | null; error?: string }> {
    const deny = (error?: string) => ({ allow: false, until: null, error });
    if (this.session) return deny(t('control.busy'));
    if (this.share?.kind !== 'screen') return deny(t('control.onlyScreen'));
    if (!loadRobot()) return deny(t('control.unavailable'));

    const win = this.getWindow();
    if (win) {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    }

    const shortcut = process.platform === 'darwin' ? '⌘⇧X' : 'Ctrl+Shift+X';
    const abort = new AbortController();
    const timeout = setTimeout(() => abort.abort(), ASK_TIMEOUT_MS);
    const options: Electron.MessageBoxOptions = {
      type: 'question',
      buttons: [t('control.allow10'), t('control.allowUntilStop'), t('control.deny')],
      defaultId: 2,
      cancelId: 2,
      noLink: true,
      title: t('control.title'),
      message: t('control.message', { name }),
      detail: t('control.detail', { shortcut }),
      signal: abort.signal,
    };
    let response: number;
    try {
      ({ response } = win ? await dialog.showMessageBox(win, options) : await dialog.showMessageBox(options));
    } finally {
      clearTimeout(timeout);
    }
    if (response === 2 || abort.signal.aborted) return deny();

    // macOS needs the Accessibility permission to send input; this opens the prompt.
    if (process.platform === 'darwin' && !systemPreferences.isTrustedAccessibilityClient(true)) {
      return deny(t('control.macAccessibility'));
    }
    // The share may have stopped while the dialog was open.
    if (this.share?.kind !== 'screen' || this.session) return deny();

    const display = this.findDisplay();
    loadRobot()?.updateScreenMetrics();
    const until = response === 0 ? Date.now() + 10 * 60_000 : null;
    this.session = {
      controllerId,
      name,
      until,
      display,
      timer: until ? setTimeout(() => this.end('expired'), until - Date.now()) : null,
      buttons: new Set(),
    };
    try {
      globalShortcut.register(STOP_SHORTCUT, () => this.end('stopped'));
    } catch {
      /* another app owns it; the banner still works */
    }
    this.showBanner(name, display);
    return { allow: true, until };
  }

  inject(controllerId: string, input: ControlInput) {
    const s = this.session;
    const r = robot;
    if (!s || !r || s.controllerId !== controllerId) return;
    if (s.until && Date.now() > s.until) return this.end('expired');

    try {
      switch (input.t) {
        case 'move': {
          const p = this.toScreen(s.display, input.x, input.y);
          r.moveMouse(p.x, p.y);
          break;
        }
        case 'button': {
          const p = this.toScreen(s.display, input.x, input.y);
          r.moveMouse(p.x, p.y);
          r.mouseToggle(input.down ? 'down' : 'up', input.button);
          if (input.down) s.buttons.add(input.button);
          else s.buttons.delete(input.button);
          break;
        }
        case 'wheel': {
          // Browsers: positive = scroll down. robotjs: positive = scroll up.
          const clamp = (v: number) => Math.max(-2000, Math.min(2000, v));
          if (process.platform === 'win32') r.scrollMouse(Math.round(clamp(input.dx) * 1.2), Math.round(clamp(-input.dy) * 1.2));
          else if (process.platform === 'darwin') r.scrollMouse(Math.round(clamp(-input.dx)), Math.round(clamp(-input.dy)));
          else r.scrollMouse(Math.sign(-input.dx) * Math.ceil(Math.abs(input.dx) / 100), Math.sign(-input.dy) * Math.ceil(Math.abs(input.dy) / 100));
          break;
        }
        case 'key':
          this.key(r, input);
          break;
      }
    } catch (err) {
      console.warn('input injection failed', err);
    }
  }

  private key(r: Robot, k: Extract<ControlInput, { t: 'key' }>) {
    const plan = planKey(k);
    if (plan?.type === 'type') r.typeString(plan.text);
    else if (plan?.type === 'tap') r.keyTap(plan.key, plan.mods);
  }

  stop() {
    if (this.session) this.end('stopped');
  }

  end(reason: ControlEndReason) {
    const s = this.session;
    if (!s) return;
    this.session = null;
    if (s.timer) clearTimeout(s.timer);
    // Never leave a mouse button stuck down.
    for (const b of s.buttons) {
      try {
        robot?.mouseToggle('up', b);
      } catch {
        /* ignore */
      }
    }
    globalShortcut.unregister(STOP_SHORTCUT);
    if (this.banner && !this.banner.isDestroyed()) this.banner.destroy();
    this.banner = null;
    this.onEnded(reason);
  }

  private findDisplay(): Display {
    const id = this.share?.displayId;
    return screen.getAllDisplays().find((d) => String(d.id) === id) ?? screen.getPrimaryDisplay();
  }

  /** 0..1 within the shared screen → OS mouse coordinates. */
  private toScreen(d: Display, nx: number, ny: number) {
    const x = Math.min(Math.max(nx, 0), 1);
    const y = Math.min(Math.max(ny, 0), 1);
    const dip = {
      x: Math.round(d.bounds.x + x * (d.bounds.width - 1)),
      y: Math.round(d.bounds.y + y * (d.bounds.height - 1)),
    };
    // robotjs uses physical pixels on Windows, points (= Electron DIPs) on macOS.
    return process.platform === 'win32' ? screen.dipToScreenPoint(dip) : dip;
  }

  private showBanner(name: string, display: Display) {
    const width = 420;
    const win = new BrowserWindow({
      width,
      height: 44,
      x: Math.round(display.workArea.x + (display.workArea.width - width) / 2),
      y: display.workArea.y + 8,
      frame: false,
      transparent: true,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      focusable: false,
      hasShadow: false,
      show: false,
      webPreferences: {
        preload: join(__dirname, 'banner-preload.js'),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
      },
    });
    win.setAlwaysOnTop(true, 'screen-saver');
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    const shortcut = process.platform === 'darwin' ? '⌘⇧X' : 'Ctrl+Shift+X';
    void win.loadFile(join(this.appRoot, 'static', 'control-banner.html'), {
      query: { text: t('banner.text', { name }), stop: t('banner.stop'), shortcut, lang: getSettings().language },
    });
    win.once('ready-to-show', () => win.showInactive());
    this.banner = win;
  }
}
