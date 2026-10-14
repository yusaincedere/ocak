import { BrowserWindow, ipcMain, screen } from 'electron';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { app } from 'electron';
import type { CallAction, CallSnapshot } from '../../web/src/desktop-bridge';

const WIDTH = 236;
const posFile = () => join(app.getPath('userData'), 'overlay-position.json');

/**
 * A small always-on-top panel shown during a call while Ocak is in the background:
 * who's in the call (and talking), plus mute / deafen / leave.
 * It never takes keyboard focus, so it won't pull you out of a game.
 */
export class Overlay {
  private win: BrowserWindow | null = null;
  private state: CallSnapshot | null = null;
  private wanted = false;

  /** The overlay window, unless it was closed (e.g. while the app quits). */
  private get alive(): BrowserWindow | null {
    return this.win && !this.win.isDestroyed() ? this.win : null;
  }

  constructor(
    private appRoot: string,
    private onAction: (a: CallAction | 'open') => void,
    /** Translated labels for the overlay page (it has no i18n of its own). */
    private getStrings: () => Record<string, string>,
  ) {
    ipcMain.on('ocak-overlay:act', (e, action: unknown) => {
      const w = this.alive;
      if (!w || e.sender !== w.webContents) return;
      if (action === 'toggle-mute' || action === 'toggle-deafen' || action === 'leave' || action === 'open') this.onAction(action);
    });
    ipcMain.on('ocak-overlay:height', (e, h: unknown) => {
      const w = this.alive;
      if (!w || e.sender !== w.webContents || typeof h !== 'number') return;
      const [, cur] = w.getSize();
      const height = Math.max(60, Math.min(Math.ceil(h), 480));
      if (cur !== height) w.setSize(WIDTH, height);
    });
  }

  setState(state: CallSnapshot | null) {
    this.state = state;
    this.alive?.webContents.send('ocak-overlay:state', state);
    this.sync();
  }

  /** Re-send the labels after the language changed. */
  refreshStrings() {
    this.alive?.webContents.send('ocak-overlay:strings', this.getStrings());
  }

  /** Whether the overlay *should* be visible (main window in background + setting on). */
  setWanted(wanted: boolean) {
    this.wanted = wanted;
    this.sync();
  }

  private sync() {
    const show = this.wanted && !!this.state;
    if (show) {
      const w = this.ensure();
      if (!w.isVisible()) w.showInactive();
    } else if (this.alive?.isVisible()) {
      this.alive.hide();
    }
  }

  private ensure(): BrowserWindow {
    if (this.alive) return this.alive;
    const { x, y } = this.initialPosition();
    const win = new BrowserWindow({
      width: WIDTH,
      height: 120,
      x,
      y,
      frame: false,
      transparent: true,
      resizable: false,
      movable: true,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      focusable: false,
      // macOS: a non-activating panel, so clicking a button doesn't switch to Ocak (which would
      // hide the overlay before the click lands); and the first click counts.
      ...(process.platform === 'darwin' ? { type: 'panel' as const } : {}),
      acceptFirstMouse: true,
      hasShadow: false,
      show: false,
      title: 'Ocak overlay',
      webPreferences: {
        preload: join(__dirname, 'overlay-preload.js'),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
      },
    });
    win.setAlwaysOnTop(true, 'screen-saver');
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    win.on('moved', () => {
      const [px, py] = win.getPosition();
      try {
        writeFileSync(posFile(), JSON.stringify({ x: px, y: py }));
      } catch {
        /* ignore */
      }
    });
    win.webContents.on('did-finish-load', () => {
      win.webContents.send('ocak-overlay:strings', this.getStrings());
      win.webContents.send('ocak-overlay:state', this.state);
    });
    void win.loadFile(join(this.appRoot, 'static', 'overlay.html'));
    this.win = win;
    return win;
  }

  private initialPosition() {
    try {
      const saved = JSON.parse(readFileSync(posFile(), 'utf8')) as { x: number; y: number };
      // Only reuse it if it's still on a connected screen.
      const onScreen = screen.getAllDisplays().some((d) => {
        const b = d.workArea;
        return saved.x >= b.x && saved.y >= b.y && saved.x < b.x + b.width - 40 && saved.y < b.y + b.height - 40;
      });
      if (onScreen) return saved;
    } catch {
      /* first time */
    }
    const area = screen.getPrimaryDisplay().workArea;
    return { x: area.x + 16, y: area.y + 16 }; // top-left corner by default
  }

  destroy() {
    this.alive?.destroy();
    this.win = null;
  }
}
