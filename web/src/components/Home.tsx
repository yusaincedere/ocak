import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ApiError } from '../api';
import { joinCall, startCall } from '../call';
import { desktop } from '../desktop-bridge';
import { forgetRoom, recentRooms, setCreateCode, setName as saveName, type RecentRoom } from '../identity';
import { parseJoinInput, roomLink } from '../links';
import { useStore } from '../store';
import { Copy, Pencil, X } from './Icons';

const ago = (t: number) => {
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
};

export function Home({ invite }: { invite: { id: string; password: string | null } | null }) {
  const name = useStore((s) => s.name);
  if (!name) return <NameStep />;
  return <Lobby invite={invite} />;
}

/** First visit: just ask for a name. */
function NameStep() {
  const [value, setValue] = useState('');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const n = value.trim();
    if (!n) return;
    saveName(n);
    useStore.getState().setName(n);
  };
  return (
    <div className="home">
      <form className="home-card" onSubmit={submit}>
        <Brand />
        <h1>What should people call you?</h1>
        <input
          className="field big"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Your name"
          maxLength={32}
          autoFocus
        />
        <button className="btn primary big" disabled={!value.trim()}>
          Continue
        </button>
        <p className="muted small center">No account. It's saved on this device only.</p>
      </form>
    </div>
  );
}

function Lobby({ invite }: { invite: { id: string; password: string | null } | null }) {
  const [busy, setBusy] = useState<'start' | 'join' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [needsCode, setNeedsCode] = useState(false);
  const [code, setCode] = useState('');
  const [joinText, setJoinText] = useState(invite ? invite.id : '');
  const [password, setPassword] = useState(invite?.password ?? '');
  const [recent, setRecent] = useState<RecentRoom[]>(recentRooms);
  const autoJoined = useRef(false);

  const parsed = parseJoinInput(joinText);
  const needsPassword = !!parsed && !parsed.password;

  async function start(e?: FormEvent) {
    e?.preventDefault();
    setBusy('start');
    setError(null);
    try {
      await startCall(needsCode ? code.trim() : undefined);
      if (needsCode) setCreateCode(code.trim());
    } catch (err) {
      if (err instanceof ApiError && err.code === 'create_code') {
        if (needsCode) setError('That code is not right.');
        setCreateCode(null);
        setNeedsCode(true);
      } else setError(errorText(err));
    } finally {
      setBusy(null);
    }
  }

  async function join(id: string, pw: string) {
    setBusy('join');
    setError(null);
    try {
      await joinCall(id, pw);
    } catch (err) {
      setError(errorText(err));
      if (err instanceof ApiError && err.code === 'not_found') {
        forgetRoom(id);
        setRecent(recentRooms());
      }
    } finally {
      setBusy(null);
    }
  }

  // Opened from an invite link with the password in it: join right away.
  useEffect(() => {
    if (invite?.password && !autoJoined.current) {
      autoJoined.current = true;
      void join(invite.id, invite.password);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const submitJoin = (e: FormEvent) => {
    e.preventDefault();
    if (!parsed) return setError('That doesn’t look like a room link or ID.');
    const pw = parsed.password ?? password.trim();
    if (!pw) return setError('Enter the room password.');
    void join(parsed.id, pw);
  };

  if (busy === 'join' && invite?.password && autoJoined.current && !error) {
    return (
      <div className="home">
        <div className="home-card center">
          <Brand />
          <p className="muted">Joining {invite.id}…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="home">
      <div className="home-card">
        <Brand />
        <NameChip />

        {needsCode ? (
          <form className="stack" onSubmit={start}>
            <label className="label">This server needs a code to start calls</label>
            <input
              className="field"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="Server code"
              autoFocus
            />
            <button className="btn primary big" disabled={!code.trim() || busy !== null}>
              {busy === 'start' ? 'Starting…' : 'Start a call'}
            </button>
          </form>
        ) : (
          <button className="btn primary big" onClick={() => void start()} disabled={busy !== null}>
            {busy === 'start' ? 'Starting…' : 'Start a call'}
          </button>
        )}

        <div className="divider">
          <span>or join</span>
        </div>

        <form className="stack" onSubmit={submitJoin}>
          <input
            className="field"
            value={joinText}
            onChange={(e) => setJoinText(e.target.value)}
            placeholder="Paste a link or room ID"
            spellCheck={false}
            autoCapitalize="off"
          />
          {needsPassword && (
            <input
              className="field"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
              spellCheck={false}
              autoCapitalize="off"
              autoFocus={!!invite}
            />
          )}
          <button className="btn" disabled={!joinText.trim() || busy !== null}>
            {busy === 'join' ? 'Joining…' : 'Join'}
          </button>
        </form>

        {error && <p className="form-error center">{error}</p>}

        {recent.length > 0 && (
          <div className="recent">
            <div className="label">Recent</div>
            {recent.map((r) => (
              <div key={r.id} className="recent-row">
                <button className="recent-join" onClick={() => void join(r.id, r.password)} disabled={busy !== null}>
                  <span className="mono">{r.id}</span>
                  <span className="muted small">{ago(r.lastUsed)}</span>
                </button>
                <CopyButton text={roomLink(r.id, r.password)} title="Copy invite link" />
                <button
                  className="icon-btn small"
                  title="Remove"
                  onClick={() => {
                    forgetRoom(r.id);
                    setRecent(recentRooms());
                  }}
                >
                  <X size={14} />
                </button>
              </div>
            ))}
          </div>
        )}
        {!desktop && <DesktopDownload />}
      </div>
    </div>
  );
}

/** "Get the desktop app" - only if the server hosts an installer for this OS. */
function DesktopDownload() {
  const [href, setHref] = useState<string | null>(null);
  useEffect(() => {
    fetch('/api/desktop-downloads')
      .then((r) => (r.ok ? r.json() : null))
      .then((l: { windows: string | null; mac: string | null } | null) => {
        if (!l) return;
        const mac = navigator.userAgent.includes('Mac');
        setHref((mac ? l.mac : l.windows) ?? null);
      })
      .catch(() => {});
  }, []);
  if (!href) return null;
  return (
    <a className="desktop-download" href={href} download>
      Get the desktop app (push-to-talk, overlay)
    </a>
  );
}

function errorText(err: unknown) {
  return err instanceof Error ? err.message : 'Something went wrong';
}

export function Brand() {
  return (
    <div className="brand">
      <img src="/favicon.svg" alt="" width={28} height={28} />
      <span>ocak</span>
    </div>
  );
}

/** "Yusa ✎" - click to rename. Used on the home screen and in calls. */
export function NameChip({ onRename }: { onRename?: (name: string) => void }) {
  const name = useStore((s) => s.name) ?? '';
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(name);

  const commit = () => {
    const n = value.trim();
    setEditing(false);
    if (!n || n === name) return setValue(name);
    saveName(n);
    useStore.getState().setName(n);
    onRename?.(n);
  };

  if (editing)
    return (
      <form
        className="name-chip editing"
        onSubmit={(e) => {
          e.preventDefault();
          commit();
        }}
      >
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => e.key === 'Escape' && (setValue(name), setEditing(false))}
          maxLength={32}
          autoFocus
        />
      </form>
    );

  return (
    <button
      className="name-chip"
      title="Change your name"
      onClick={() => {
        setValue(name);
        setEditing(true);
      }}
    >
      <span className="muted">You are</span> <strong>{name}</strong> <Pencil size={13} />
    </button>
  );
}

export function CopyButton({ text, title, label }: { text: string; title: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className={label ? 'btn small-btn' : 'icon-btn small'}
      title={title}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          useStore.getState().setNotice(text);
        }
      }}
    >
      {copied ? <span className="copied">Copied</span> : label ? (<><Copy size={14} /> {label}</>) : <Copy size={14} />}
    </button>
  );
}
