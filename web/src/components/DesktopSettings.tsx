import { useState, type KeyboardEvent } from 'react';
import { desktop, type DesktopSettings as Settings } from '../desktop-bridge';
import { translate, useT } from '../i18n';
import { useStore } from '../store';
import { LanguageSwitch } from './Home';

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
  const named: Record<string, string> = {
    ' ': 'Space',
    ArrowUp: 'Up',
    ArrowDown: 'Down',
    ArrowLeft: 'Left',
    ArrowRight: 'Right',
  };
  const k = named[key] ?? (key.length === 1 ? key.toUpperCase() : key);
  return [...parts, k].join('+');
}

const prettyAccel = (a: string) => a.replace('CommandOrControl', isMac ? '⌘' : 'Ctrl').replace(/\+/g, ' + ');

export function DesktopSettings({ onClose }: { onClose: () => void }) {
  const settings = useStore((s) => s.desktopSettings);
  const [capturing, setCapturing] = useState(false);
  const [recordingMute, setRecordingMute] = useState(false);
  const [server, setServer] = useState(settings?.serverUrl ?? '');
  const [serverError, setServerError] = useState<string | null>(null);
  const t = useT();

  const noiseReduction = useStore((s) => s.noiseReduction);
  const chatSound = useStore((s) => s.chatSound);

  const save = async (patch: Partial<Settings>) => {
    if (!desktop) return;
    const next = await desktop.setSettings(patch);
    if (next) useStore.getState().setDesktopSettings(next);
  };

  const bindKey = async () => {
    setCapturing(true);
    try {
      const b = await desktop!.captureHotkey();
      if (b) await save({ pttBinding: b, pushToTalk: true });
      else if (!settings?.pttBinding) useStore.getState().setNotice(translate('settings.noKey'));
    } finally {
      setCapturing(false);
    }
  };

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal settings" role="dialog" aria-label={t('settings.title')}>
        <header className="modal-head">
          <h2>{t('settings.title')}</h2>
        </header>

        <section className="setting">
          <h3>{t('settings.language')}</h3>
          <LanguageSwitch />
        </section>

        <section className="setting">
          <div>
            <h3>{t('audio.noise')}</h3>
            <p className="muted">{t('audio.noiseDesc')}</p>
          </div>
          <label className="switch">
            <input
              type="checkbox"
              checked={noiseReduction}
              onChange={(e) => useStore.getState().setNoiseReduction(e.target.checked)}
            />
            <span />
          </label>
        </section>

        <section className="setting">
          <div>
            <h3>{t('settings.chatSound')}</h3>
            <p className="muted">{t('settings.chatSoundDesc')}</p>
          </div>
          <label className="switch">
            <input type="checkbox" checked={chatSound} onChange={(e) => useStore.getState().setChatSound(e.target.checked)} />
            <span />
          </label>
        </section>

        {/* Everything below only exists in the desktop app. */}
        {desktop && settings && (
          <>
            <section className="setting">
              <div>
                <h3>{t('settings.ptt')}</h3>
                <p className="muted">{t('settings.pttDesc')}</p>
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
              <span className="muted">{t('settings.key')}</span>
              <button className="btn key" onClick={bindKey} disabled={capturing}>
                {capturing ? t('settings.pressKey') : (settings.pttBinding?.label ?? t('settings.chooseKey'))}
              </button>
            </section>
            {isMac && <p className="hint">{t('settings.macAccessibility')}</p>}

            <section className="setting">
              <div>
                <h3>{t('settings.muteShortcut')}</h3>
                <p className="muted">{t('settings.muteShortcutDesc')}</p>
              </div>
              <input
                className={`accel${recordingMute ? ' recording' : ''}`}
                readOnly
                value={recordingMute ? t('settings.pressKeys') : prettyAccel(settings.muteShortcut)}
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
                <h3>{t('settings.overlay')}</h3>
                <p className="muted">{t('settings.overlayDesc')}</p>
              </div>
              <label className="switch">
                <input type="checkbox" checked={settings.overlay} onChange={(e) => void save({ overlay: e.target.checked })} />
                <span />
              </label>
            </section>

            {!isMac && (
              <section className="setting">
                <div>
                  <h3>{t('settings.tray')}</h3>
                  <p className="muted">{t('settings.trayDesc')}</p>
                </div>
                <label className="switch">
                  <input
                    type="checkbox"
                    checked={settings.closeToTray}
                    onChange={(e) => void save({ closeToTray: e.target.checked })}
                  />
                  <span />
                </label>
              </section>
            )}

            <section className="setting column">
              <h3>{t('settings.server')}</h3>
              <form
                className="server-row"
                onSubmit={async (e) => {
                  e.preventDefault();
                  setServerError(null);
                  const res = await desktop!.connect(server);
                  if (!res.ok) setServerError(res.error ?? t('settings.invalidAddress'));
                }}
              >
                <input value={server} onChange={(e) => setServer(e.target.value)} />
                <button className="btn" disabled={server === settings.serverUrl}>
                  {t('settings.switch')}
                </button>
              </form>
              {serverError && <p className="form-error">{serverError}</p>}
            </section>
          </>
        )}

        <footer className="modal-foot">
          <span className="muted small">{desktop ? t('settings.version', { version: desktop.version }) : ''}</span>
          <button className="btn primary" onClick={onClose}>
            {t('common.done')}
          </button>
        </footer>
      </div>
    </div>
  );
}
