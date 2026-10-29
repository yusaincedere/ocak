import { useParticipants, useRoomContext } from '@livekit/components-react';
import { RoomEvent, type RemoteParticipant } from 'livekit-client';
import { useEffect, useRef, useState } from 'react';
import { LOL_TOPIC, type LolMatchSummary, type LolPlayerStats } from '../../../server/src/protocol';
import { api } from '../api';
import { useT, type MessageKey } from '../i18n';
import { icon, sameRiotId } from '../lol';
import { riotIdOf } from '../presence';
import { useStore } from '../store';
import { X } from './Icons';

// After a game: whoever in the call has a Riot ID set notices their latest game changed,
// tells the call over the data channel, and everyone sees the same card.

const POLL_MS = 60_000;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** Fun numbers for the whole call: games and wins tonight (this call). */
export interface NightScore {
  wins: number;
  losses: number;
}

export function usePostGame() {
  const room = useRoomContext();
  const riot = useStore((s) => s.riot);
  const enabled = useStore((s) => !!s.lolMeta?.enabled);
  const [shown, setShown] = useState<LolMatchSummary | null>(null);
  const [night, setNight] = useState<NightScore>({ wins: 0, losses: 0 });
  const seen = useRef(new Set<string>());
  const participants = useParticipants();
  const friendsRef = useRef<string[]>([]);
  friendsRef.current = participants.map((p) => (p.isLocal ? (riot?.riotId ?? null) : riotIdOf(p))).filter((x): x is string => !!x);

  const show = useRef(async (id: string) => {
    if (seen.current.has(id)) return;
    seen.current.add(id);
    try {
      const summary = await api.lolMatch(id);
      const ours = summary.players.find((p) => friendsRef.current.some((f) => sameRiotId(f, p.riotId)));
      if (ours) setNight((n) => (ours.win ? { ...n, wins: n.wins + 1 } : { ...n, losses: n.losses + 1 }));
      setShown(summary);
    } catch {
      seen.current.delete(id);
    }
  });

  // Someone else's game ended.
  useEffect(() => {
    const onData = (payload: Uint8Array, _from?: RemoteParticipant, _k?: unknown, topic?: string) => {
      if (topic !== LOL_TOPIC) return;
      try {
        const msg = JSON.parse(decoder.decode(payload)) as { t?: string; id?: string };
        if (msg.t === 'match' && typeof msg.id === 'string' && /^[A-Z0-9]{2,5}_\d{5,15}$/.test(msg.id)) void show.current(msg.id);
      } catch {
        /* ignore */
      }
    };
    room.on(RoomEvent.DataReceived, onData);
    return () => {
      room.off(RoomEvent.DataReceived, onData);
    };
  }, [room]);

  // Our own games: check now and then whether the latest one changed.
  useEffect(() => {
    if (!enabled || !riot) return;
    let baseline: string | null | undefined;
    let stopped = false;
    const check = async () => {
      try {
        const { matchId } = await api.lolLatest(riot.riotId, riot.platform);
        if (stopped) return;
        if (baseline === undefined) baseline = matchId; // the game before this call: not news
        else if (matchId && matchId !== baseline) {
          baseline = matchId;
          void room.localParticipant
            .publishData(encoder.encode(JSON.stringify({ t: 'match', id: matchId })), { reliable: true, topic: LOL_TOPIC })
            .catch(() => {});
          void show.current(matchId);
        }
      } catch {
        /* Riot hiccup: try again next time */
      }
    };
    void check();
    const timer = setInterval(check, POLL_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [enabled, riot, room]);

  return { shown, close: () => setShown(null), night, friends: friendsRef.current };
}

// ---------- the card ----------

const kda = (p: LolPlayerStats) => (p.kills + p.assists) / Math.max(1, p.deaths);

/** Our own "who carried" score: fights, damage share, kill participation, vision. */
export function mvpScore(p: LolPlayerStats, all: LolPlayerStats[], minutes: number) {
  const teamDamage = all.filter((x) => x.teamId === p.teamId).reduce((s, x) => s + x.damage, 0) || 1;
  return (
    p.kills * 3 +
    p.assists * 1.5 -
    p.deaths * 1.5 +
    (p.damage / teamDamage) * 25 +
    p.killParticipation * 8 +
    (p.vision / Math.max(1, minutes)) * 2 +
    (p.win ? 3 : 0)
  );
}

type Award = { key: MessageKey; who: LolPlayerStats; value?: string };

export function awardsFor(
  players: LolPlayerStats[],
  friends: string[],
  minutes: number,
  num: (n: number) => string = (n) => n.toLocaleString(),
): { mvp: LolPlayerStats; awards: Award[] } {
  const mvp = players.reduce((a, b) => (mvpScore(b, players, minutes) > mvpScore(a, players, minutes) ? b : a));
  const ours = players.filter((p) => friends.some((f) => sameRiotId(f, p.riotId)));
  // Awards go to the friends in the game (or to everyone if we can't tell who they are).
  const pool = ours.length ? ours : players;
  const top = (f: (p: LolPlayerStats) => number) => pool.reduce((a, b) => (f(b) > f(a) ? b : a));
  // The game's MVP first, whoever it is (one of us, hopefully).
  const awards: Award[] = [{ key: 'pg.mvp', who: mvp, value: `${mvp.kills}/${mvp.deaths}/${mvp.assists}` }];
  for (const p of pool) if (p.pentaKills > 0) awards.push({ key: 'pg.award.penta', who: p });
  const dmg = top((p) => p.damage);
  awards.push({ key: 'pg.award.damage', who: dmg, value: num(dmg.damage) });
  const tank = top((p) => p.damageTaken + p.mitigated);
  awards.push({ key: 'pg.award.tank', who: tank, value: num(tank.damageTaken) });
  const deathless = pool.find((p) => p.deaths === 0);
  if (deathless) awards.push({ key: 'pg.award.deathless', who: deathless });
  const healer = top((p) => p.healing);
  if (healer.healing >= 3000) awards.push({ key: 'pg.award.heal', who: healer, value: num(healer.healing) });
  const vision = top((p) => p.vision);
  awards.push({ key: 'pg.award.vision', who: vision, value: String(vision.vision) });
  if (pool.length > 1) {
    const deaths = top((p) => p.deaths);
    if (deaths.deaths >= 6) awards.push({ key: 'pg.award.deaths', who: deaths, value: String(deaths.deaths) });
  }
  return { mvp, awards };
}

export function PostGameCard({
  match,
  friends,
  night,
  onClose,
}: {
  match: LolMatchSummary;
  friends: string[];
  night: NightScore;
  onClose: () => void;
}) {
  const t = useT();
  const meta = useStore((s) => s.lolMeta);
  const version = meta?.version ?? match.version.split('.').slice(0, 2).join('.') + '.1';
  const names = new Map((meta?.champions ?? []).map((c) => [c.id, c.name]));
  const minutes = Math.round(match.duration / 60);
  const isFriend = (p: LolPlayerStats) => friends.some((f) => sameRiotId(f, p.riotId));
  const ours = match.players.filter(isFriend);
  const ourTeamWon = ours.length ? ours[0]!.win : null;
  const lang = useStore((s) => s.lang);
  const fmt = (n: number) => n.toLocaleString(lang === 'tr' ? 'tr-TR' : 'en-GB');
  const { mvp, awards } = awardsFor(match.players, friends, minutes, fmt);
  const maxDamage = Math.max(...match.players.map((p) => p.damage), 1);
  const [all, setAll] = useState(false);
  const queue = t((`pg.queue.${match.queueId}` in QUEUES ? `pg.queue.${match.queueId}` : 'pg.queue.other') as MessageKey);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const nameOf = (p: LolPlayerStats) => p.riotId.split('#')[0] || names.get(p.champion) || p.champion;
  const row = (p: LolPlayerStats) => (
    <div key={p.puuid} className={`pg-player${isFriend(p) ? ' friend' : ''}${p === mvp ? ' mvp' : ''}`}>
      <img className="pg-champ" src={icon.champion(version, p.champion)} alt={names.get(p.champion) ?? p.champion} title={names.get(p.champion) ?? p.champion} />
      <div className="pg-who">
        <span className="pg-name">
          {nameOf(p)}
          {p === mvp && <span className="pg-mvp">{t('pg.mvp')}</span>}
        </span>
        <span className="pg-kda">
          {p.kills}/{p.deaths}/{p.assists} <span className="muted">· {kda(p).toFixed(1)}</span>
        </span>
      </div>
      <div className="pg-dmg" title={`${t('pg.damage')}: ${fmt(p.damage)}`}>
        <div className="pg-bar">
          <span style={{ width: `${(p.damage / maxDamage) * 100}%` }} />
        </div>
        <span className="pg-num">{fmt(p.damage)}</span>
      </div>
      <div className="pg-mini muted small">
        <span title={t('pg.gold')}>{(p.gold / 1000).toFixed(1)}k</span>
        <span title={t('pg.cs')}>{p.cs} cs</span>
        <span title={t('pg.vision')}>👁 {p.vision}</span>
      </div>
    </div>
  );

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal pg-card" role="dialog" aria-label={t('pg.title')}>
        <header
          className={`pg-top${ourTeamWon === null ? '' : ourTeamWon ? ' win' : ' loss'}`}
          style={{ '--splash': `url(${icon.splash((ours[0] ?? mvp).champion)})` } as React.CSSProperties}
        >
          <div>
            <div className="pg-result">{ourTeamWon === null ? t('pg.title') : ourTeamWon ? t('pg.victory') : t('pg.defeat')}</div>
            <div className="small pg-sub">
              {queue} · {t('pg.minutes', { m: minutes })}
              {night.wins + night.losses > 1 && <> · {t('pg.night', { w: night.wins, l: night.losses })}</>}
            </div>
          </div>
          <button className="icon-btn small" title={t('pg.close')} onClick={onClose}>
            <X size={16} />
          </button>
        </header>

        <div className="pg-awards">
          {awards.map((a, i) => (
            <div key={i} className={`pg-award${a.key === 'pg.award.penta' ? ' penta' : ''}${a.key === 'pg.mvp' ? ' mvp' : ''}`}>
              <img src={icon.champion(version, a.who.champion)} alt="" />
              <div>
                <div className="pg-award-title">{t(a.key)}</div>
                <div className="small muted">
                  {nameOf(a.who)}
                  {a.value ? ` · ${a.value}` : ''}
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="pg-list">
          {all || !ours.length
            ? [100, 200].map((team) => (
                <div key={team} className="pg-team">
                  {match.players.filter((p) => p.teamId === team).map(row)}
                </div>
              ))
            : ours.map(row)}
        </div>

        {ours.length > 0 && ours.length < match.players.length && (
          <button className="btn subtle small-btn pg-all" onClick={() => setAll((v) => !v)}>
            {t('pg.allPlayers')} {all ? '▲' : '▼'}
          </button>
        )}
      </div>
    </div>
  );
}

const QUEUES: Record<string, true> = {
  'pg.queue.420': true,
  'pg.queue.440': true,
  'pg.queue.400': true,
  'pg.queue.430': true,
  'pg.queue.490': true,
  'pg.queue.450': true,
  'pg.queue.1700': true,
};
