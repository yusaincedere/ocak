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

  constructor(
    private appRoot: string,
    private onAction: (a: CallAction | 'open') => void,
  ) {
    ipcMain.on('ocak-overlay:act', (e, action: unknown) => {
      if (!this.win || e.sender !== this.win.webContents) return;
      if (action === 'toggle-mute' || action === 'toggle-deafen' || action === 'leave' || action === 'open') this.onAction(action);
    });
    ipcMain.on('ocak-overlay:height', (e, h: unknown) => {
      if (!this.win || e.sender !== this.win.webContents || typeof h !== 'number') return;
      const [, cur] = this.win.getSize();
      const height = Math.max(60, Math.min(Math.ceil(h), 480));
      if (cur !== height) this.win.setSize(WIDTH, height);
    });
  }

  setState(state: CallSnapshot | null) {
    this.state = state;
    this.win?.webContents.send('ocak-overlay:state', state);
    this.sync();
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
    } else if (this.win?.isVisible()) {
      this.win.hide();
    }
  }

  private ensure(): BrowserWindow {
    if (this.win && !this.win.isDestroyed()) return this.win;
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
    win.webContents.on('did-finish-load', () => win.webContents.send('ocak-overlay:state', this.state));
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
    this.win?.destroy();
    this.win = null;
  }
}
