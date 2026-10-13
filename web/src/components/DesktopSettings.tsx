import { useState, type KeyboardEvent } from 'react';
import { desktop, type DesktopSettings as Settings } from '../desktop-bridge';
import { useStore } from '../store';

const isMac = desktop?.platform === 'darwin';

/** Turn a keydown into an Electron accelerator string like "CommandOrControl+Shift+M". */
function toAccelerator(e: KeyboardEvent): string | null {
  const key = e.key;
  if (['Control', 'Shift', 'Alt', 'Meta'].includes(key)) return null; // wait for a real key
  const parts: string[] = [];
  if (e.ctrlKey || e.metaKey) parts.push('CommandOrControl');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  if (!parts.length) return null; // require a modifier so normal typing isn't hijacked
  const named: Record<string, string> = { ' ': 'Space', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right' };
  const k = named[key] ?? (key.length === 1 ? key.toUpperCase() : key);
  return [...parts, k].join('+');
}

const prettyAccel = (a: string) =>
  a.replace('CommandOrControl', isMac ? '⌘' : 'Ctrl').replace(/\+/g, ' + ');

export function DesktopSettings({ onClose }: { onClose: () => void }) {
  const settings = useStore((s) => s.desktopSettings);
  const [capturing, setCapturing] = useState(false);
  const [recordingMute, setRecordingMute] = useState(false);
  const [server, setServer] = useState(settings?.serverUrl ?? '');
  const [serverError, setServerError] = useState<string | null>(null);

  if (!desktop || !settings) return null;

  const save = async (patch: Partial<Settings>) => {
    const next = await desktop!.setSettings(patch);
    if (next) useStore.getState().setDesktopSettings(next);
  };

  const bindKey = async () => {
    setCapturing(true);
    try {
      const b = await desktop!.captureHotkey();
      if (b) await save({ pttBinding: b, pushToTalk: true });
      else if (!settings.pttBinding) useStore.getState().setNotice('No key captured. Push-to-talk may be unavailable on this system.');
    } finally {
      setCapturing(false);
    }
  };

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal settings" role="dialog" aria-label="Desktop settings">
        <header className="modal-head">
          <h2>Settings</h2>
        </header>

        <section className="setting">
          <div>
            <h3>Push-to-talk</h3>
            <p className="muted">Your mic only transmits while you hold the key - even when Ocak is in the background.</p>
          </div>
          <label className="switch">
            <input
              type="checkbox"
              checked={settings.pushToTalk}
              onChange={(e) => {
                if (e.target.checked && !settings.pttBinding) void bindKey();
                else void save({ pushToTalk: e.target.checked });
              }}
            />
            <span />
          </label>
        </section>
        <section className="setting sub">
          <span className="muted">Key</span>
          <button className="btn key" onClick={bindKey} disabled={capturing}>
            {capturing ? 'Press any key or mouse button… (Esc to cancel)' : (settings.pttBinding?.label ?? 'Choose a key')}
          </button>
        </section>
        {isMac && (
          <p className="hint">
            On macOS, allow Ocak under System Settings → Privacy &amp; Security → Accessibility for push-to-talk to work in
            other apps.
          </p>
        )}

        <section className="setting">
          <div>
            <h3>Mute shortcut</h3>
            <p className="muted">Toggle your mic from anywhere.</p>
          </div>
          <input
            className={`accel${recordingMute ? ' recording' : ''}`}
            readOnly
            value={recordingMute ? 'Press keys…' : prettyAccel(settings.muteShortcut)}
            onFocus={() => setRecordingMute(true)}
            onBlur={() => setRecordingMute(false)}
            onKeyDown={(e) => {
              e.preventDefault();
              if (e.key === 'Escape') return (e.target as HTMLInputElement).blur();
              const accel = toAccelerator(e);
              if (accel) {
                void save({ muteShortcut: accel });
                (e.target as HTMLInputElement).blur();
              }
            }}
          />
        </section>

        <section className="setting">
          <div>
            <h3>Mini overlay</h3>
            <p className="muted">A small floating panel with who's talking and mute / deafen / leave, shown while you're in another app.</p>
          </div>
          <label className="switch">
            <input type="checkbox" checked={settings.overlay} onChange={(e) => void save({ overlay: e.target.checked })} />
            <span />
          </label>
        </section>

        {!isMac && (
          <section className="setting">
            <div>
              <h3>Keep running in the tray</h3>
              <p className="muted">Closing the window keeps you connected. Quit from the tray icon.</p>
            </div>
            <label className="switch">
              <input type="checkbox" checked={settings.closeToTray} onChange={(e) => void save({ closeToTray: e.target.checked })} />
              <span />
            </label>
          </section>
        )}

        <section className="setting column">
          <h3>Server</h3>
          <form
            className="server-row"
            onSubmit={async (e) => {
              e.preventDefault();
              setServerError(null);
              const res = await desktop!.connect(server);
              if (!res.ok) setServerError(res.error ?? 'Invalid address');
            }}
          >
            <input value={server} onChange={(e) => setServer(e.target.value)} />
            <button className="btn" disabled={server === settings.serverUrl}>
              Switch
            </button>
          </form>
          {serverError && <p className="form-error">{serverError}</p>}
        </section>

        <footer className="modal-foot">
          <span className="muted small">Ocak desktop {desktop.version}</span>
          <button className="btn primary" onClick={onClose}>
            Done
          </button>
        </footer>
      </div>
    </div>
  );
}
