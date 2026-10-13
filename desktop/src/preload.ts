// Runs in the page before it loads (sandboxed). Exposes a small, explicit API as
// `window.ocakDesktop`; the page never gets direct access to Node or Electron.
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type { CallAction, DesktopSettings, HotkeyBinding, OcakDesktop, ScreenSource } from '../../web/src/desktop-bridge';

const info = ipcRenderer.sendSync('ocak:info') as { version: string; platform: OcakDesktop['platform'] };

function subscribe<T extends unknown[]>(channel: string, cb: (...args: T) => void) {
  const listener = (_e: IpcRendererEvent, ...args: unknown[]) => cb(...(args as T));
  ipcRenderer.on(channel, listener);
  return () => {
    ipcRenderer.removeListener(channel, listener);
  };
}

const api: OcakDesktop = {
  platform: info.platform,
  version: info.version,
  canShareSystemAudio: info.platform === 'win32',

  onPickSource: (cb) => subscribe<[ScreenSource[]]>('ocak:pick-source', cb),
  pickSource: (id, withAudio) => ipcRenderer.send('ocak:picked', id, withAudio),

  onPushToTalk: (cb) => subscribe<[boolean]>('ocak:ptt', cb),
  onCallAction: (cb) => subscribe<[CallAction]>('ocak:call-action', cb),
  setCallState: (state) => ipcRenderer.send('ocak:call-state', state),

  connect: (serverUrl) => ipcRenderer.invoke('ocak:connect', serverUrl) as Promise<{ ok: boolean; error?: string }>,
  getSettings: () => ipcRenderer.invoke('ocak:get-settings') as Promise<DesktopSettings>,
  setSettings: (patch) => ipcRenderer.invoke('ocak:set-settings', patch) as Promise<DesktopSettings>,
  captureHotkey: () => ipcRenderer.invoke('ocak:capture-hotkey') as Promise<HotkeyBinding | null>,

  requestAttention: () => ipcRenderer.send('ocak:attention'),
};

contextBridge.exposeInMainWorld('ocakDesktop', api);
