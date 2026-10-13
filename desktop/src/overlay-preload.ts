// Bridge for the overlay page (static/overlay.html). Tiny on purpose.
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type { CallSnapshot } from '../../web/src/desktop-bridge';

contextBridge.exposeInMainWorld('ocakOverlay', {
  onState(cb: (s: CallSnapshot | null) => void) {
    ipcRenderer.on('ocak-overlay:state', (_e: IpcRendererEvent, s: CallSnapshot | null) => cb(s));
  },
  act(action: 'toggle-mute' | 'toggle-deafen' | 'leave' | 'open') {
    ipcRenderer.send('ocak-overlay:act', action);
  },
  setHeight(h: number) {
    ipcRenderer.send('ocak-overlay:height', h);
  },
});
