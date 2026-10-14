import { useEffect, useState } from 'react';
import { desktop, type ScreenSource } from '../desktop-bridge';
import { translate, useT } from '../i18n';
import { useStore } from '../store';
import { Screen } from './Icons';

/**
 * Desktop app only: Discord-style "choose what to share" dialog.
 * The main process sends the list of screens/windows; we answer with the chosen one.
 */
export function ScreenPicker() {
  const [sources, setSources] = useState<ScreenSource[] | null>(null);
  const [tab, setTab] = useState<'screen' | 'window'>('screen');
  const [selected, setSelected] = useState<string | null>(null);
  const [withAudio, setWithAudio] = useState(false);
  const t = useT();

  useEffect(
    () =>
      desktop?.onPickSource((list) => {
        setSources(list);
        setTab(list.some((s) => s.kind === 'screen') ? 'screen' : 'window');
        setSelected(list.find((s) => s.kind === 'screen')?.id ?? null);
      }),
    [],
  );

  // Why a share was refused (macOS permission, no screens...): the page only sees a generic error.
  useEffect(
    () =>
      desktop?.onShareError?.((reason) =>
        useStore.getState().setNotice(translate(reason === 'permission' ? 'picker.permission' : 'picker.failed')),
      ),
    [],
  );

  const answer = (id: string | null) => {
    desktop?.pickSource(id, withAudio);
    setSources(null);
    setSelected(null);
  };

  useEffect(() => {
    if (!sources) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && answer(null);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (!desktop || !sources) return null;
  const shown = sources.filter((s) => s.kind === tab);

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && answer(null)}>
      <div className="modal picker" role="dialog" aria-label={t('picker.title')}>
        <header className="modal-head">
          <h2>{t('picker.title')}</h2>
          <div className="tabs">
            <button className={tab === 'screen' ? 'on' : ''} onClick={() => setTab('screen')}>
              {t('picker.screens')}
            </button>
            <button className={tab === 'window' ? 'on' : ''} onClick={() => setTab('window')}>
              {t('picker.apps')}
            </button>
          </div>
        </header>

        <div className="picker-grid">
          {shown.map((s) => (
            <button
              key={s.id}
              className={`picker-item${selected === s.id ? ' selected' : ''}`}
              onClick={() => setSelected(s.id)}
              onDoubleClick={() => answer(s.id)}
            >
              <img src={s.thumbnail} alt="" />
              <span className="picker-name">
                {s.appIcon && <img src={s.appIcon} alt="" width={16} height={16} />}
                {s.name}
              </span>
            </button>
          ))}
          {shown.length === 0 && <p className="muted">{t('picker.empty')}</p>}
        </div>

        <footer className="modal-foot">
          {desktop.canShareSystemAudio ? (
            <label className="check" title={t('picker.audioHint')}>
              <input type="checkbox" checked={withAudio} onChange={(e) => setWithAudio(e.target.checked)} />
              {t('picker.audio')}
            </label>
          ) : (
            <span />
          )}
          <div className="modal-actions">
            <button className="btn subtle" onClick={() => answer(null)}>
              {t('common.cancel')}
            </button>
            <button className="btn primary" disabled={!selected} onClick={() => answer(selected)}>
              <Screen size={16} /> {t('picker.goLive')}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
