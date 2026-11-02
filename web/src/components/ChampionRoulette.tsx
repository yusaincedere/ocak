import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import type { LolMeta, LolRole } from '../../../server/src/protocol';
import { useT } from '../i18n';
import { icon } from '../lol';
import { ROULETTE_LANES, roulettePool, rouletteSpin } from '../roulette';
import { sounds } from '../sounds';
import { X } from './Icons';

const CELL = 96;
const offset = (index: number) => `translateX(calc(50% - ${(index + 0.5) * CELL}px))`;

export function ChampionRoulette({ meta, onClose, onPick, onLanded }: {
  meta: LolMeta;
  onClose: () => void;
  onPick: (id: string, lane?: LolRole) => void;
  onLanded: (champion: string) => void;
}) {
  const t = useT();
  const dialog = useRef<HTMLDialogElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const busy = useRef(false);
  const [lane, setLane] = useState<LolRole | ''>('');
  const [sound, setSound] = useState(false);
  const soundOn = useRef(sound);
  soundOn.current = sound;
  const landed = useRef(onLanded);
  landed.current = onLanded;
  const [spin, setSpin] = useState<ReturnType<typeof rouletteSpin>>(null);
  const [phase, setPhase] = useState<'ready' | 'spinning' | 'landed'>('ready');
  const pool = roulettePool(meta.champions ?? [], lane);
  const preview = pool.length ? Array.from({ length: 7 }, (_, i) => pool[i % pool.length]!) : [];
  const cards = spin?.reel ?? preview;
  const winner = phase === 'landed' ? spin?.winner : null;

  useEffect(() => {
    const previous = document.activeElement;
    const modal = dialog.current!;
    modal.showModal();
    return () => {
      modal.close();
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);

  useLayoutEffect(() => {
    if (!spin || !track.current) return;
    let cancelled = false;
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const animation = track.current.animate(
      [{ transform: offset(2) }, { transform: offset(spin.stop) }],
      { duration: reduced ? 0 : 4500, easing: 'cubic-bezier(.12,.68,.12,1)', fill: 'forwards' },
    );
    const timers = reduced ? [] : [0, 70, 150, 240, 350, 480, 640, 830, 1060, 1330, 1650, 2020, 2440, 2910, 3430, 3970, 4350]
      .map((delay) => window.setTimeout(() => { if (soundOn.current) sounds.rouletteTick(); }, delay));
    void animation.finished.then(() => {
      if (cancelled) return;
      busy.current = false;
      setPhase('landed');
      landed.current(spin.winner.name);
      if (soundOn.current) sounds.rouletteWin();
    }).catch(() => { /* Closing the dialog cancels the reel. */ });
    return () => {
      cancelled = true;
      timers.forEach(clearTimeout);
      animation.cancel();
    };
  }, [spin]);

  const roll = () => {
    if (busy.current || !pool.length) return;
    busy.current = true;
    if (soundOn.current) sounds.rouletteTick();
    setPhase('spinning');
    setSpin(rouletteSpin(pool));
  };

  return (
    <dialog ref={dialog} className="roulette-backdrop" aria-label={t('roulette.title')}
      onCancel={(e) => { e.preventDefault(); onClose(); }}
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <section className={`roulette-machine ${phase}`}>
        <header className="roulette-heading">
          <span className="roulette-eyebrow">OCAK · CHAMPION CLUB</span>
          <button type="button" className="icon-btn" aria-label={t('lol.close')} onClick={onClose}><X /></button>
        </header>
        <h1>{t('roulette.title')}</h1>
        <p className="roulette-subtitle">{t('roulette.subtitle')}</p>

        <div className="roulette-lanes" role="group" aria-label={t('roulette.lane')}>
          {(['', ...ROULETTE_LANES] as const).map((value) => (
            <button type="button" key={value || 'any'} aria-pressed={lane === value} disabled={phase === 'spinning'}
              onClick={() => { setLane(value); setSpin(null); setPhase('ready'); }}>
              {value ? t(`lol.role.${value}`) : t('roulette.any')}
            </button>
          ))}
        </div>

        <div className="roulette-marquee" aria-hidden="true"><span /> ◆ <span /></div>
        <div className="roulette-reel" aria-hidden="true">
          <div className="roulette-pointer" />
          <div className="roulette-selection" />
          <div className="roulette-track" ref={track} style={{ '--cell': `${CELL}px`, transform: offset(spin?.stop ?? 2) } as CSSProperties}>
            {cards.map((champion, index) => (
              <div className="roulette-card" key={`${index}-${champion.id}`}>
                <img src={icon.champion(meta.version!, champion.id)} alt="" draggable={false}
                  onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }} />
                <strong>{champion.name}</strong>
              </div>
            ))}
          </div>
          <div className="roulette-fade left" /><div className="roulette-fade right" />
        </div>

        <div className="roulette-outcome" role="status" aria-live="polite" aria-atomic="true">
          {winner ? <>
            <span className="roulette-eyebrow">{t('roulette.yourPick')}</span>
            <strong className="roulette-winner">{winner.name}</strong>
            <span className="roulette-result-lane">{lane ? t(`lol.role.${lane}`) : t('roulette.any')}</span>
          </> : <>
            <strong>{t(phase === 'spinning' ? 'roulette.spinning' : pool.length ? 'roulette.ready' : 'roulette.empty')}</strong>
            <span>{t('roulette.pool', { n: pool.length })}</span>
          </>}
        </div>

        <div className="roulette-actions">
          <button type="button" className="roulette-spin" onClick={roll} disabled={!pool.length || phase === 'spinning'}>
            <span aria-hidden="true">✦</span> {t(phase === 'spinning' ? 'roulette.spinning' : winner ? 'roulette.again' : 'roulette.spin')} <span aria-hidden="true">✦</span>
          </button>
          {winner && <button type="button" className="roulette-build" onClick={() => { onPick(winner.id, lane || undefined); onClose(); }}>
            {t('roulette.build')}
          </button>}
        </div>
        <footer className="roulette-foot">
          <span>{t(lane ? 'roulette.laneSource' : 'roulette.equalChance')}</span>
          <button type="button" aria-pressed={sound} onClick={() => setSound(!sound)}>{t(sound ? 'roulette.soundOn' : 'roulette.soundOff')}</button>
        </footer>
      </section>
    </dialog>
  );
}
