import { useCallback, useEffect, useState, type FormEvent } from 'react';
import type { AdminRoom, AdminRooms } from '../../../server/src/protocol';
import { api, ApiError } from '../api';
import { joinCallAsAdmin } from '../call';
import { translate, useT, type Lang } from '../i18n';
import { roomLink } from '../links';
import { colorFor, initials } from '../presence';
import { useStore } from '../store';
import { Brand, CopyButton } from './Home';
import { MicOff } from './Icons';

// /admin: every room on the server, who is in each call, and what an admin can do about it.

const REFRESH_MS = 5000;

const errorText = (err: unknown) => (err instanceof Error ? err.message : translate('common.somethingWrong'));

function relative(t: number, lang: Lang) {
  const fmt = new Intl.RelativeTimeFormat(lang, { numeric: 'auto' });
  const s = Math.round((t - Date.now()) / 1000);
  const abs = Math.abs(s);
  if (abs < 60) return fmt.format(s, 'second');
  if (abs < 3600) return fmt.format(Math.round(s / 60), 'minute');
  if (abs < 86400) return fmt.format(Math.round(s / 3600), 'hour');
  return fmt.format(Math.round(s / 86400), 'day');
}

export function AdminPage() {
  const t = useT();
  const isAdmin = useStore((s) => s.isAdmin);
  const config = useStore((s) => s.serverConfig);

  return (
    <div className="admin">
      <header className="admin-top">
        <a className="admin-home" href="/" title={t('admin.backHome')}>
          <Brand />
        </a>
        <span className="admin-tag">{t('admin.badge')}</span>
        <div className="spacer" />
        {isAdmin && (
          <button className="btn subtle small-btn" onClick={() => useStore.getState().setAdminKey(null)}>
            {t('admin.signOut')}
          </button>
        )}
      </header>
      {config && !config.adminEnabled ? (
        <div className="admin-empty">
          <h1>{t('admin.offTitle')}</h1>
          <p className="muted">{t('admin.offHint')}</p>
        </div>
      ) : isAdmin ? (
        <Dashboard />
      ) : (
        <KeyForm />
      )}
    </div>
  );
}

function KeyForm() {
  const t = useT();
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.admin.check(key.trim());
      useStore.getState().setAdminKey(key.trim());
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="admin-key home-card" onSubmit={submit}>
      <h1>{t('admin.signInTitle')}</h1>
      <p className="muted">{t('admin.signInHint')}</p>
      <input
        className="field big mono"
        type="password"
        autoComplete="off"
        value={key}
        onChange={(e) => setKey(e.target.value)}
        placeholder={t('admin.keyPlaceholder')}
        autoFocus
      />
      {error && <p className="form-error" role="alert">{error}</p>}
      <button className="btn primary big" disabled={!key.trim() || busy}>
        {t('admin.signIn')}
      </button>
    </form>
  );
}

function Dashboard() {
  const t = useT();
  const [data, setData] = useState<AdminRooms | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'live'>('all');

  const load = useCallback(async () => {
    try {
      setData(await api.admin.rooms());
      setError(null);
    } catch (err) {
      // The key was changed on the server: back to the key form.
      if (err instanceof ApiError && err.code === 'admin_key') useStore.getState().setAdminKey(null);
      setError(errorText(err));
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = setInterval(() => document.visibilityState === 'visible' && void load(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [load]);

  const rooms = data?.rooms.filter((r) => filter === 'all' || r.people.length > 0) ?? [];
  const liveCount = data?.rooms.filter((r) => r.people.length > 0).length ?? 0;
  const peopleCount = data?.rooms.reduce((n, r) => n + r.people.length, 0) ?? 0;

  return (
    <main className="admin-main">
      <div className="admin-stats">
        <div><strong>{data?.rooms.length ?? '–'}</strong><span className="muted small">{t('admin.statRooms')}</span></div>
        <div><strong>{data ? liveCount : '–'}</strong><span className="muted small">{t('admin.statLive')}</span></div>
        <div><strong>{data ? peopleCount : '–'}</strong><span className="muted small">{t('admin.statPeople')}</span></div>
      </div>

      <div className="admin-toolbar">
        <div className="segmented" role="tablist">
          <button role="tab" aria-selected={filter === 'all'} className={filter === 'all' ? 'on' : ''} onClick={() => setFilter('all')}>
            {t('admin.filterAll')}
          </button>
          <button role="tab" aria-selected={filter === 'live'} className={filter === 'live' ? 'on' : ''} onClick={() => setFilter('live')}>
            {t('admin.filterLive')}
          </button>
        </div>
        <div className="spacer" />
        <button className="btn subtle small-btn" onClick={() => void load()}>
          {t('admin.refresh')}
        </button>
      </div>

      {error && <p className="form-error" role="alert">{error}</p>}
      {data && !data.live && <p className="admin-warning">{t('admin.livekitDown')}</p>}
      {data && rooms.length === 0 && <p className="muted center">{t(filter === 'live' ? 'admin.noLive' : 'admin.noRooms')}</p>}

      <div className="admin-rooms">
        {rooms.map((room) => (
          <RoomCard key={room.id} room={room} onChange={load} />
        ))}
      </div>
    </main>
  );
}

function RoomCard({ room, onChange }: { room: AdminRoom; onChange: () => Promise<void> }) {
  const t = useT();
  const lang = useStore((s) => s.lang);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState<string | null>(null);
  const live = room.people.length > 0;

  const run = async (action: () => Promise<unknown>, confirmText?: string) => {
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(true);
    setError(null);
    try {
      await action();
      await onChange();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={`admin-room${live ? ' live' : ''}`}>
      <div className="admin-room-head">
        <span className="room-name">{room.id}</span>
        {live && <span className="live-tag">{t('admin.inCall', { n: room.people.length })}</span>}
        <div className="spacer" />
        <button className="btn primary small-btn" disabled={busy} onClick={() => void run(() => joinCallAsAdmin(room.id))}>
          {t('admin.join')}
        </button>
      </div>
      <div className="admin-room-meta muted small">
        <span>{t('admin.created', { when: relative(room.createdAt, lang) })}</span>
        <span>{t('admin.lastUsed', { when: relative(room.lastUsedAt, lang) })}</span>
        <span>{t('admin.expires', { when: relative(room.expiresAt, lang) })}</span>
      </div>

      {live && (
        <ul className="admin-people">
          {room.people.map((p) => (
            <li key={p.identity}>
              <span className="admin-dot" style={{ background: colorFor(p.identity) }}>{initials(p.name)}</span>
              <span className="admin-person-name">{p.name}</span>
              {!p.micOn && <span className="muted" title={t('person.micOff')}><MicOff size={14} /></span>}
              <span className="muted small">{relative(p.joinedAt, lang)}</span>
              <div className="spacer" />
              <button className="btn subtle small-btn" disabled={busy || !p.micOn} onClick={() => void run(() => api.admin.mute(room.id, p.identity))}>
                {t('admin.mute')}
              </button>
              <button
                className="btn subtle small-btn danger"
                disabled={busy}
                onClick={() => void run(() => api.admin.kick(room.id, p.identity), t('admin.kickConfirm', { name: p.name }))}
              >
                {t('admin.kick')}
              </button>
            </li>
          ))}
        </ul>
      )}

      {newPassword && (
        <div className="admin-password">
          <span className="muted small">{t('admin.newPasswordIs')}</span>
          <span className="mono big-mono">{newPassword}</span>
          <CopyButton text={roomLink(room.id, newPassword)} title={t('home.copyInvite')} label={t('home.copyInvite')} />
        </div>
      )}
      {error && <p className="form-error" role="alert">{error}</p>}

      <div className="admin-room-actions">
        <button
          className="btn subtle small-btn"
          disabled={busy}
          onClick={() =>
            void run(async () => setNewPassword((await api.admin.newPassword(room.id)).password), t('admin.newPasswordConfirm', { room: room.id }))
          }
        >
          {t('admin.newPassword')}
        </button>
        {live && (
          <button className="btn subtle small-btn danger" disabled={busy} onClick={() => void run(() => api.admin.endCall(room.id), t('admin.endConfirm', { room: room.id }))}>
            {t('admin.endCall')}
          </button>
        )}
        <button className="btn subtle small-btn danger" disabled={busy} onClick={() => void run(() => api.admin.deleteRoom(room.id), t('admin.deleteConfirm', { room: room.id }))}>
          {t('admin.delete')}
        </button>
      </div>
    </section>
  );
}
