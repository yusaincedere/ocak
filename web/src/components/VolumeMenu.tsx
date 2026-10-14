import type { Participant } from 'livekit-client';
import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent, type PointerEvent } from 'react';
import { create } from 'zustand';
import { useT } from '../i18n';
import { deviceOf } from '../presence';
import { useStore } from '../store';
import { Volume, VolumeOff } from './Icons';

// Right-click (or long-press) someone in the call to set how loud they are *for you*.
// Remembered per friend (by device), so it sticks across calls.

interface Target {
  device: string;
  name: string;
  x: number;
  y: number;
}

const useMenu = create<{ target: Target | null; open: (t: Target) => void; close: () => void }>((set) => ({
  target: null,
  open: (target) => set({ target }),
  close: () => set({ target: null }),
}));

const LONG_PRESS_MS = 500;

/** Props to spread on anything that represents a person; does nothing for yourself. */
export function usePersonMenu(participant: Participant | undefined) {
  const t = useT();
  const press = useRef<{ timer: number; x: number; y: number } | null>(null);
  if (!participant || participant.isLocal) return {};

  const open = (x: number, y: number) =>
    useMenu.getState().open({ device: deviceOf(participant.identity), name: participant.name || participant.identity, x, y });
  const cancel = () => {
    if (press.current) clearTimeout(press.current.timer);
    press.current = null;
  };

  return {
    title: t('volume.hint'),
    onContextMenu: (e: MouseEvent) => {
      e.preventDefault();
      open(e.clientX, e.clientY);
    },
    // Touch screens: hold for half a second.
    onPointerDown: (e: PointerEvent) => {
      if (e.pointerType !== 'touch') return;
      const { clientX: x, clientY: y } = e;
      cancel();
      press.current = { x, y, timer: window.setTimeout(() => open(x, y), LONG_PRESS_MS) };
    },
    onPointerMove: (e: PointerEvent) => {
      const p = press.current;
      if (p && Math.hypot(e.clientX - p.x, e.clientY - p.y) > 10) cancel();
    },
    onPointerUp: cancel,
    onPointerCancel: cancel,
  };
}

/** The per-friend volume popup; rendered once inside the call. */
export function VolumeMenu() {
  const t = useT();
  const target = useMenu((s) => s.target);
  const volume = useStore((s) => (target ? (s.volumes[target.device] ?? 1) : 1));
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const beforeMute = useRef(1);

  // Keep the popup on screen.
  useLayoutEffect(() => {
    if (!target || !ref.current) return setPos(null);
    const { width, height } = ref.current.getBoundingClientRect();
    setPos({
      left: Math.max(8, Math.min(target.x, window.innerWidth - width - 8)),
      top: Math.max(8, Math.min(target.y, window.innerHeight - height - 8)),
    });
  }, [target]);

  useEffect(() => {
    if (!target) return;
    const close = () => useMenu.getState().close();
    const onDown = (e: Event) => !ref.current?.contains(e.target as Node) && close();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', close);
    };
  }, [target]);

  if (!target) return null;
  const set = (v: number) => useStore.getState().setVolume(target.device, v);
  const percent = Math.round(volume * 100);

  return (
    <div
      ref={ref}
      className="volume-menu"
      role="dialog"
      aria-label={t('volume.title', { name: target.name })}
      style={pos ?? { left: target.x, top: target.y, visibility: 'hidden' }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="volume-head">
        <strong className="volume-name">{target.name}</strong>
        <span className="muted small">{t('volume.label')}</span>
      </div>
      <div className="volume-row">
        <button
          type="button"
          className={`icon-btn small${volume === 0 ? ' off' : ''}`}
          title={volume === 0 ? t('volume.unmute') : t('volume.mute')}
          aria-label={volume === 0 ? t('volume.unmute') : t('volume.mute')}
          onClick={() => {
            if (volume === 0) set(beforeMute.current || 1);
            else {
              beforeMute.current = volume;
              set(0);
            }
          }}
        >
          {volume === 0 ? <VolumeOff size={16} /> : <Volume size={16} />}
        </button>
        <input
          type="range"
          min={0}
          max={200}
          step={5}
          value={percent}
          aria-label={t('volume.label')}
          onChange={(e) => set(Number(e.target.value) / 100)}
          style={{ '--fill': `${percent / 2}%` } as React.CSSProperties}
        />
        <span className="volume-value">{percent}%</span>
      </div>
      {percent !== 100 && (
        <button type="button" className="btn subtle small-btn" onClick={() => set(1)}>
          {t('volume.reset')}
        </button>
      )}
    </div>
  );
}
