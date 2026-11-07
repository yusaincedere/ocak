import { useEffect, type CSSProperties } from 'react';
import { useT } from '../i18n';
import { PRESETS, presetStyle } from '../name-presets';
import { useStore } from '../store';
import { X } from './Icons';
import { StyledName } from './StyledName';
import type { MessageKey } from '../i18n';

/** The built-in name styles, each shown live with this name. */
export function NameStyleGrid({ name, selected, onPick }: { name: string; selected: string | null; onPick: (id: string | null) => void }) {
  const t = useT();
  const shown = name.trim() || 'ocak';
  return (
    <div className="name-styles" role="radiogroup" aria-label={t('name.styles')} style={{ '--chars': Math.max(4, Array.from(shown).length) } as CSSProperties}>
      <button type="button" role="radio" aria-checked={!selected} className={`name-style-card${selected ? '' : ' selected'}`} onClick={() => onPick(null)}>
        <span className="name-style-sample">{shown}</span>
        <span className="name-style-label">{t('name.noStyle')}</span>
      </button>
      {PRESETS.map((p) => {
        const style = presetStyle(p.id, shown);
        if (!style) return null;
        return (
          <button
            key={p.id}
            type="button"
            role="radio"
            aria-checked={selected === p.id}
            className={`name-style-card${selected === p.id ? ' selected' : ''}`}
            onClick={() => onPick(p.id)}
          >
            <span className="name-style-sample">
              <StyledName name={shown} style={style} />
            </span>
            <span className="name-style-label">{t(`namePreset.${p.id}` as MessageKey)}</span>
          </button>
        );
      })}
    </div>
  );
}

/** Picking a built-in style for your name; it applies right away (also mid-call). */
export function NameStyleDialog({ onClose }: { onClose: () => void }) {
  const t = useT();
  const name = useStore((s) => s.name) ?? '';
  const preset = useStore((s) => s.namePreset);
  const pasted = useStore((s) => !!s.nameStyle && !s.namePreset);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal name-style-modal" role="dialog" aria-label={t('name.styles')}>
        <header className="modal-head">
          <h2>{t('name.styles')}</h2>
          <button className="icon-btn small" title={t('common.cancel')} onClick={onClose}>
            <X size={16} />
          </button>
        </header>
        <div className="name-style-body">
          <p className="muted small">{t('name.stylesHint')}</p>
          <NameStyleGrid
            name={name}
            selected={preset ?? (pasted ? 'pasted' : null)}
            onPick={(id) => (id ? useStore.getState().setNamePreset(id) : useStore.getState().setNameStyle(null))}
          />
        </div>
      </div>
    </div>
  );
}
