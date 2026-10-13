// Bridge for the "X is controlling your screen" banner (static/control-banner.html).
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('ocakBanner', {
  stop() {
    ipcRenderer.send('ocak-banner:stop');
  },
});
