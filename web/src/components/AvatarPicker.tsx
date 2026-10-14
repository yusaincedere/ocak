import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { Gender } from '../../../server/src/protocol';
import { api, ApiError } from '../api';
import { clampPick, cropStyle, defaultPick, dragPick, MIN_ZOOM, type AvatarPick } from '../avatar';
import { useT } from '../i18n';
import { getGender, setGender as saveGender } from '../identity';
import { useStore } from '../store';
import { X } from './Icons';

const FRAME = 232; // px, the round preview

/** Loads the picture to learn its real shape (picture APIs don't always report it). */
function loadImage(src: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => (img.naturalWidth && img.naturalHeight ? resolve(img.naturalWidth / img.naturalHeight) : reject(new Error('empty')));
    img.onerror = () => reject(new Error('load'));
    img.src = src;
  });
}

/**
 * Random profile picture with a round crop you can drag and zoom.
 * The picture APIs don't place heads consistently, so the person nudges it into the circle.
 */
export function AvatarPicker({
  initial,
  onDone,
  secondary,
}: {
  /** Start from an existing picture (re-crop) instead of fetching a new one. */
  initial?: AvatarPick | null;
  onDone: (pick: AvatarPick) => void;
  /** e.g. "Continue without a picture" / "Remove picture" */
  secondary: { label: string; onClick: () => void };
}) {
  const t = useT();
  const genders = useStore((s) => s.serverConfig?.avatarGenders ?? []);
  const [gender, setGender] = useState<Gender | null>(() => {
    const saved = getGender();
    return saved && genders.includes(saved) ? saved : (genders[0] ?? null);
  });
  const [pick, setPick] = useState<AvatarPick | null>(initial ?? null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const request = useRef(0);

  const fetchOne = useCallback(
    async (g: Gender) => {
      const id = ++request.current;
      setLoading(true);
      setError(null);
      try {
        const { src } = await api.randomAvatar(g);
        const ar = await loadImage(src);
        if (id === request.current) setPick(defaultPick(src, ar));
      } catch (err) {
        if (id === request.current) setError(err instanceof ApiError ? err.message : t('avatar.failed'));
      } finally {
        if (id === request.current) setLoading(false);
      }
    },
    [t],
  );

  useEffect(() => {
    if (!initial && gender) void fetchOne(gender);
    // only on open
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const chooseGender = (g: Gender) => {
    if (g === gender) return;
    setGender(g);
    saveGender(g);
    void fetchOne(g);
  };

  // ---- drag + zoom ----
  const frame = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number } | null>(null);
  const onPointerDown = (e: ReactPointerEvent) => {
    if (!pick) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY };
  };
  const onPointerMove = (e: ReactPointerEvent) => {
    const start = drag.current;
    if (!start) return;
    drag.current = { x: e.clientX, y: e.clientY };
    setPick((p) => (p ? dragPick(p, e.clientX - start.x, e.clientY - start.y, FRAME) : p));
  };
  const onPointerUp = () => (drag.current = null);

  useEffect(() => {
    const el = frame.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      setPick((p) => (p ? clampPick({ ...p, zoom: p.zoom * Math.exp(e.deltaY * 0.0015) }) : p));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const slider = pick ? Math.round(((1 - pick.zoom) / (1 - MIN_ZOOM)) * 100) : 0;

  return (
    <div className="avatar-picker">
      {genders.length > 1 && (
        <div className="tabs gender-tabs" role="radiogroup">
          {genders.map((g) => (
            <button key={g} type="button" role="radio" aria-checked={g === gender} className={g === gender ? 'on' : ''} onClick={() => chooseGender(g)}>
              {t(g === 'male' ? 'avatar.male' : 'avatar.female')}
            </button>
          ))}
        </div>
      )}

      <div
        ref={frame}
        className={`avatar-editor${loading ? ' loading' : ''}`}
        style={{ width: FRAME, height: FRAME }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        {pick && <img src={pick.src} style={cropStyle(pick)} alt="" draggable={false} />}
        {loading && <span className="spinner" aria-label={t('avatar.loading')} />}
      </div>

      {error ? <p className="form-error center">{error}</p> : <p className="muted small center">{t('avatar.hint')}</p>}

      <label className="zoom-row">
        <span className="muted small">{t('avatar.zoom')}</span>
        <input
          type="range"
          min={0}
          max={100}
          value={slider}
          disabled={!pick}
          onChange={(e) => setPick((p) => (p ? clampPick({ ...p, zoom: 1 - (Number(e.target.value) / 100) * (1 - MIN_ZOOM) }) : p))}
        />
      </label>

      <div className="avatar-actions">
        <button type="button" className="btn" disabled={loading || !gender} onClick={() => gender && void fetchOne(gender)}>
          <span aria-hidden>🎲</span> {t('avatar.another')}
        </button>
        <button type="button" className="btn primary" disabled={!pick || loading} onClick={() => pick && onDone(pick)}>
          {t('avatar.use')}
        </button>
      </div>
      <button type="button" className="btn subtle small-btn" onClick={secondary.onClick}>
        {secondary.label}
      </button>
    </div>
  );
}

/** The picker in a dialog, for changing your picture later (home screen or mid-call). */
export function AvatarDialog({ onClose }: { onClose: () => void }) {
  const t = useT();
  const avatar = useStore((s) => s.avatar);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal avatar-modal" role="dialog" aria-label={t('avatar.title')}>
        <header className="modal-head">
          <h2>{t('avatar.title')}</h2>
          <button className="icon-btn small" title={t('common.cancel')} onClick={onClose}>
            <X size={16} />
          </button>
        </header>
        <AvatarPicker
          initial={avatar}
          onDone={(pick) => {
            useStore.getState().setAvatar(pick);
            onClose();
          }}
          secondary={
            avatar
              ? {
                  label: t('avatar.remove'),
                  onClick: () => {
                    useStore.getState().setAvatar(null);
                    onClose();
                  },
                }
              : { label: t('common.cancel'), onClick: onClose }
          }
        />
      </div>
    </div>
  );
}
