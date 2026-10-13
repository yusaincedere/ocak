import {
  app,
  BrowserWindow,
  desktopCapturer,
  globalShortcut,
  ipcMain,
  Menu,
  nativeImage,
  session,
  shell,
  systemPreferences,
  Tray,
  type DesktopCapturerSource,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
} from 'electron';
import { join } from 'node:path';
import type { CallAction, CallSnapshot, ControlInput, ScreenSource } from '../../web/src/desktop-bridge';
import { RemoteControl } from './control';
import { Hotkeys } from './hotkeys';
import { Overlay } from './overlay';
import { getSettings, normalizeServerUrl, updateSettings } from './settings';

const APP_ROOT = app.getAppPath();
const ICON = join(APP_ROOT, 'build', 'icon.png');
const TRAY_ICON = join(APP_ROOT, 'build', 'tray.png');
const SETUP_PAGE = join(APP_ROOT, 'static', 'setup.html');

let win: BrowserWindow | null = null;
let tray: Tray | null = null;
let quitting = false;

// ---------- single instance ----------

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => showWindow());
}

app.setAppUserModelId('app.ocak.desktop'); // Windows notifications & taskbar grouping

// ---------- trust: only our server (and the local setup page) may use the bridge ----------

function serverOrigin(): string | null {
  const url = getSettings().serverUrl;
  try {
    return url ? new URL(url).origin : null;
  } catch {
    return null;
  }
}

function isTrustedUrl(url: string | undefined): boolean {
  if (!url) return false;
  if (url.startsWith('file://')) return url.includes('/static/setup.html');
  try {
    return new URL(url).origin === serverOrigin();
  } catch {
    return false;
  }
}

function fromTrusted(e: IpcMainEvent | IpcMainInvokeEvent): boolean {
  return isTrustedUrl(e.senderFrame?.url);
}

// ---------- window ----------

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 560,
    title: 'Ocak',
    icon: ICON,
    backgroundColor: '#111214',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: true,
      // Keep audio, timers and the socket alive while minimized / in the tray.
      backgroundThrottling: false,
    },
  });

  win.once('ready-to-show', () => win?.show());

  win.on('close', (e) => {
    if (!quitting && getSettings().closeToTray && process.platform !== 'darwin') {
      e.preventDefault();
      win?.hide();
    }
  });

  // Links to other sites open in the real browser; the app window stays on our server.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!isTrustedUrl(url)) {
      e.preventDefault();
      if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    }
  });

  win.webContents.on('did-fail-load', (_e, code, desc, url, isMainFrame) => {
    if (isMainFrame && code !== -3 /* aborted */ && !url.startsWith('file://')) {
      void win?.loadFile(SETUP_PAGE, { query: { error: `Could not reach ${url} (${desc})` } });
    }
  });

  loadApp();
}

function loadApp() {
  const url = getSettings().serverUrl;
  if (url) void win?.loadURL(url);
  else void win?.loadFile(SETUP_PAGE);
}

function showWindow() {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

// ---------- permissions ----------

const ALLOWED_PERMISSIONS = new Set(['media', 'notifications', 'clipboard-sanitized-write', 'fullscreen', 'display-capture']);

function setupPermissions() {
  const ses = session.defaultSession;
  ses.setPermissionRequestHandler((_wc, permission, cb, details) => {
    cb(ALLOWED_PERMISSIONS.has(permission) && isTrustedUrl(details.requestingUrl));
  });
  ses.setPermissionCheckHandler((_wc, permission, origin) => ALLOWED_PERMISSIONS.has(permission) && isTrustedUrl(origin));
  setupScreenPicker(ses);
}

// ---------- screen share picker ----------
// Electron has no built-in picker for getDisplayMedia, so we list screens/windows here
// and let the web app show its own picker UI, then answer with the chosen source.

type Pending = { callback: (streams: Electron.Streams) => void; sources: DesktopCapturerSource[] };
let pendingPick: Pending | null = null;

function setupScreenPicker(ses: Electron.Session) {
  ses.setDisplayMediaRequestHandler(async (request, callback) => {
    if (!win || !isTrustedUrl(request.frame?.url)) return callback({});
    pendingPick?.callback({}); // cancel any previous unanswered request
    try {
      const sources = await desktopCapturer.getSources({
        types: ['screen', 'window'],
        thumbnailSize: { width: 400, height: 225 },
        fetchWindowIcons: true,
      });
      pendingPick = { callback, sources };
      const list: ScreenSource[] = sources.map((s) => ({
        id: s.id,
        name: s.name,
        kind: s.id.startsWith('screen:') ? 'screen' : 'window',
        thumbnail: s.thumbnail.toDataURL(),
        appIcon: s.appIcon && !s.appIcon.isEmpty() ? s.appIcon.toDataURL() : undefined,
      }));
      win.webContents.send('ocak:pick-source', list);
    } catch (err) {
      console.error('getSources failed', err);
      pendingPick = null;
      callback({});
    }
  });

  ipcMain.on('ocak:picked', (e, id: unknown, withAudio: unknown) => {
    if (!fromTrusted(e)) return;
    const p = pendingPick;
    pendingPick = null;
    if (!p) return;
    const source = p.sources.find((s) => s.id === id);
    if (!source) return p.callback({});
    control.setShare(source.id, source.display_id || null);
    p.callback({
      video: source,
      // System audio loopback is only supported on Windows.
      ...(withAudio === true && process.platform === 'win32' ? { audio: 'loopback' as const } : {}),
    });
  });
}

// ---------- hotkeys ----------

const hotkeys = new Hotkeys((down) => win?.webContents.send('ocak:ptt', down));

function applyHotkeys() {
  const s = getSettings();
  hotkeys.setBinding(s.pushToTalk ? s.pttBinding : null);

  globalShortcut.unregisterAll();
  if (s.muteShortcut) {
    try {
      const ok = globalShortcut.register(s.muteShortcut, () => sendCallAction('toggle-mute'));
      if (!ok) console.warn(`Mute shortcut ${s.muteShortcut} is taken by another app`);
    } catch (err) {
      console.warn(`Invalid mute shortcut "${s.muteShortcut}"`, err);
    }
  }
}

// ---------- tray ----------

function sendCallAction(action: CallAction) {
  win?.webContents.send('ocak:call-action', action);
}

// ---------- call state: tray menu + overlay ----------

let callState: CallSnapshot | null = null;
let trayKey: string | null = null;

const overlay = new Overlay(APP_ROOT, (action) => (action === 'open' ? showWindow() : sendCallAction(action)));

const control = new RemoteControl(
  APP_ROOT,
  () => win,
  (reason) => win?.webContents.send('ocak:control-ended', reason),
);

/** Overlay shows while in a call and the main window isn't the one you're looking at. */
function updateOverlayVisibility() {
  const background = !win || !win.isVisible() || win.isMinimized() || !win.isFocused();
  overlay.setWanted(getSettings().overlay && background);
}

function createTray() {
  const image = nativeImage.createFromPath(TRAY_ICON).resize({ width: 16, height: 16 });
  tray = new Tray(image);
  tray.on('click', showWindow);
  updateTray();
}

function updateTray() {
  if (!tray) return;
  const c = callState;
  // Only rebuild when something shown in the menu changed (not on every "who's talking" update).
  const key = c ? `${c.roomId}|${c.muted}|${c.deafened}|${c.participants.length}` : '';
  if (key === trayKey) return;
  trayKey = key;

  tray.setToolTip(c ? `Ocak — in call (${c.participants.length})${c.muted ? ' · muted' : ''}` : 'Ocak');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      ...(c
        ? ([
            { label: `In call · ${c.roomId} · ${c.participants.length} ${c.participants.length === 1 ? 'person' : 'people'}`, enabled: false },
            { label: 'Mute', type: 'checkbox', checked: c.muted, click: () => sendCallAction('toggle-mute') },
            { label: 'Deafen', type: 'checkbox', checked: c.deafened, click: () => sendCallAction('toggle-deafen') },
            { label: 'Leave call', click: () => sendCallAction('leave') },
            { type: 'separator' },
          ] as Electron.MenuItemConstructorOptions[])
        : []),
      { label: 'Open Ocak', click: showWindow },
      {
        label: 'Change server…',
        click: () => {
          showWindow();
          void win?.loadFile(SETUP_PAGE, { query: { change: '1' } });
        },
      },
      { type: 'separator' },
      { label: 'Quit', click: () => ((quitting = true), app.quit()) },
    ]),
  );
}

// ---------- IPC ----------

function setupIpc() {
  ipcMain.on('ocak:info', (e) => {
    e.returnValue = { version: app.getVersion(), platform: process.platform };
  });

  ipcMain.handle('ocak:connect', (e, raw: unknown) => {
    if (!fromTrusted(e) || typeof raw !== 'string') return { ok: false, error: 'Not allowed' };
    const url = normalizeServerUrl(raw);
    if (!url) return { ok: false, error: 'Enter a valid address. It must use https:// (plain http only works for localhost).' };
    updateSettings({ serverUrl: url });
    setImmediate(loadApp);
    return { ok: true };
  });

  ipcMain.handle('ocak:get-settings', (e) => (fromTrusted(e) ? getSettings() : null));

  ipcMain.handle('ocak:set-settings', (e, patch: unknown) => {
    if (!fromTrusted(e)) return null;
    const before = getSettings().serverUrl;
    const next = updateSettings(patch);
    applyHotkeys();
    updateOverlayVisibility();
    if (next.serverUrl !== before) setImmediate(loadApp);
    return next;
  });

  ipcMain.handle('ocak:capture-hotkey', async (e) => {
    if (!fromTrusted(e)) return null;
    return hotkeys.captureNext();
  });

  // ---- remote control ----
  ipcMain.handle('ocak:share-kind', (e) => (fromTrusted(e) ? control.shareKind : null));
  ipcMain.on('ocak:share-stopped', (e) => {
    if (fromTrusted(e)) control.shareStopped();
  });
  ipcMain.handle('ocak:control-confirm', async (e, controllerId: unknown, name: unknown) => {
    if (!fromTrusted(e) || typeof controllerId !== 'string' || typeof name !== 'string')
      return { allow: false, until: null };
    return control.confirm(controllerId.slice(0, 128), name.slice(0, 64) || 'Someone');
  });
  ipcMain.on('ocak:control-input', (e, controllerId: unknown, input: unknown) => {
    if (!fromTrusted(e) || typeof controllerId !== 'string' || !isControlInput(input)) return;
    control.inject(controllerId, input);
  });
  ipcMain.on('ocak:control-stop', (e) => {
    if (fromTrusted(e)) control.stop();
  });

  ipcMain.on('ocak:call-state', (e, state: unknown) => {
    if (!fromTrusted(e)) return;
    callState = isSnapshot(state) ? state : null;
    updateTray();
    overlay.setState(callState);
    updateOverlayVisibility();
  });

  ipcMain.on('ocak:attention', (e) => {
    if (!fromTrusted(e) || !win || win.isFocused()) return;
    if (process.platform === 'darwin') app.dock?.bounce('informational');
    else win.flashFrame(true);
  });
}

// ---------- lifecycle ----------

app.whenReady().then(async () => {
  if (process.platform === 'darwin') {
    // Ask up front so the first call doesn't stall on a permission prompt.
    await systemPreferences.askForMediaAccess('microphone').catch(() => false);
  }
  setupPermissions();
  setupIpc();
  createWindow();
  createTray();
  applyHotkeys();

  win?.on('focus', () => win?.flashFrame(false));
  for (const ev of ['focus', 'blur', 'show', 'hide', 'minimize', 'restore'] as const) {
    win?.on(ev as 'focus', () => setImmediate(updateOverlayVisibility));
  }
  // Page reload / navigation drops the call.
  win?.webContents.on('did-start-navigation', (_e, _url, _inPlace, isMainFrame) => {
    if (isMainFrame) {
      callState = null;
      updateTray();
      overlay.setState(null);
      control.shareStopped();
    }
  });
});

/** Strict shape check for input events coming from the page. */
function isControlInput(v: unknown): v is ControlInput {
  if (!v || typeof v !== 'object') return false;
  const i = v as Record<string, unknown>;
  const num = (n: unknown) => typeof n === 'number' && Number.isFinite(n);
  switch (i.t) {
    case 'move':
      return num(i.x) && num(i.y);
    case 'button':
      return ['left', 'right', 'middle'].includes(i.button as string) && typeof i.down === 'boolean' && num(i.x) && num(i.y);
    case 'wheel':
      return num(i.dx) && num(i.dy);
    case 'key':
      return (
        typeof i.code === 'string' &&
        i.code.length < 32 &&
        typeof i.key === 'string' &&
        i.key.length < 16 &&
        typeof i.down === 'boolean' &&
        ['shift', 'ctrl', 'alt', 'meta'].every((m) => typeof i[m] === 'boolean')
      );
    default:
      return false;
  }
}

/** Light validation of what the page sends us. */
function isSnapshot(v: unknown): v is CallSnapshot {
  if (!v || typeof v !== 'object') return false;
  const s = v as CallSnapshot;
  return (
    typeof s.roomId === 'string' &&
    s.roomId.length < 20 &&
    typeof s.muted === 'boolean' &&
    typeof s.deafened === 'boolean' &&
    Array.isArray(s.participants) &&
    s.participants.length < 200 &&
    s.participants.every((p) => p && typeof p.name === 'string' && p.name.length <= 64 && typeof p.speaking === 'boolean')
  );
}

app.on('activate', () => showWindow()); // macOS dock click
app.on('before-quit', () => {
  quitting = true;
});
app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  hotkeys.stop();
  overlay.destroy();
  control.stop();
});
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
