import {
  LiveKitRoom,
  RoomAudioRenderer,
  useChat,
  useConnectionState,
  useLocalParticipant,
  useParticipants,
  useRoomContext,
} from '@livekit/components-react';
import { ConnectionState, RoomEvent } from 'livekit-client';
import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { leaveCall, roomOptions } from '../call';
import { desktop } from '../desktop-bridge';
import { translate, useT } from '../i18n';
import { roomLink } from '../links';
import { setPresence } from '../presence';
import { sounds } from '../sounds';
import { useStore, type Call } from '../store';
import { DesktopIntegration, usePushToTalk } from './DesktopIntegration';
import { DesktopSettings } from './DesktopSettings';
import { CopyButton, NameChip } from './Home';
import { Chat, Gear, Send, UserPlus, X } from './Icons';
import { SharerControl, ViewerControl } from './RemoteControl';
import { ScreenPicker } from './ScreenPicker';
import { Stage } from './Stage';
import { CameraButton, DeafenButton, IconButton, LeaveButton, MicButton, ScreenShareButton } from './VoiceControls';

export function CallView({ call }: { call: Call }) {
  const deafened = useStore((s) => s.deafened);
  const ptt = usePushToTalk();

  return (
    <LiveKitRoom
      key={call.token}
      className="call"
      serverUrl={call.url}
      token={call.token}
      connect
      audio={!ptt} // in push-to-talk mode DesktopIntegration publishes the mic muted
      video={false}
      options={roomOptions}
      onDisconnected={() => {
        // Still "in" the call in our state = we didn't press leave.
        if (useStore.getState().call) {
          leaveCall();
          useStore.getState().setNotice(translate('call.disconnected'));
        }
      }}
      onError={(err) => {
        // Errors after we pressed leave are just the connection closing.
        if (useStore.getState().call) useStore.getState().setNotice(translate('call.problem', { message: err.message }));
      }}
      onMediaDeviceFailure={() => useStore.getState().setNotice(translate('call.deviceBlocked'))}
    >
      <RoomAudioRenderer muted={deafened} />
      <DesktopIntegration roomId={call.roomId} />
      <CallSounds />
      <AvatarSync />
      <ScreenPicker />
      <CallLayout call={call} />
    </LiveKitRoom>
  );
}

function CallLayout({ call }: { call: Call }) {
  const participants = useParticipants();
  const connection = useConnectionState();
  const { localParticipant } = useLocalParticipant();
  const [chatOpen, setChatOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const chat = useChat();
  const [seen, setSeen] = useState(0);
  const t = useT();

  // Count unread chat while the panel is closed; ping on messages from others.
  const lastCount = useRef(0);
  useEffect(() => {
    const msgs = chat.chatMessages;
    if (msgs.length > lastCount.current) {
      const last = msgs[msgs.length - 1];
      if (!chatOpen && last && !last.from?.isLocal) sounds.message();
    }
    lastCount.current = msgs.length;
    if (chatOpen) setSeen(msgs.length);
  }, [chat.chatMessages, chatOpen]);
  const unread = chatOpen ? 0 : chat.chatMessages.length - seen;

  const status =
    connection === ConnectionState.Connecting
      ? t('call.connecting')
      : connection === ConnectionState.Reconnecting || connection === ConnectionState.SignalReconnecting
        ? t('call.reconnecting')
        : null;

  return (
    <>
      <header className="call-top">
        <div className="call-room">
          <span className="room-name">{call.roomId}</span>
          <InviteButton call={call} />
        </div>
        <span className="muted small">
          {status ?? t('call.inCall', { n: participants.length })}
        </span>
        <div className="spacer" />
        <NameChip onRename={(n) => void localParticipant.setName(n).catch(() => {})} />
        {desktop && (
          <IconButton label={t('common.settings')} onClick={() => setSettingsOpen(true)}>
            <Gear />
          </IconButton>
        )}
      </header>

      <div className="call-body">
        <div className="stage-wrap">
          {connection === ConnectionState.Connected && participants.length === 1 && <AloneHint call={call} />}
          <Stage />
          <ViewerControl />
          {desktop && <SharerControl />}
        </div>
        {chatOpen && <ChatPanel chat={chat} onClose={() => setChatOpen(false)} />}
      </div>

      <footer className="controls">
        <MicButton />
        <DeafenButton />
        <CameraButton />
        <ScreenShareButton />
        <IconButton label={chatOpen ? t('controls.hideChat') : t('controls.chat')} active={chatOpen} onClick={() => setChatOpen((v) => !v)} className="chat-btn">
          <Chat />
          {unread > 0 && <span className="badge">{unread > 9 ? '9+' : unread}</span>}
        </IconButton>
        <LeaveButton />
      </footer>

      {settingsOpen && <DesktopSettings onClose={() => setSettingsOpen(false)} />}
    </>
  );
}

function AloneHint({ call }: { call: Call }) {
  const t = useT();
  return (
    <div className="alone">
      <span>{t('call.alone')}</span>
      <CopyButton text={roomLink(call.roomId, call.password)} title={t('home.copyInvite')} label={t('home.copyInvite')} />
    </div>
  );
}

function InviteButton({ call }: { call: Call }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const t = useT();
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [open]);
  const link = roomLink(call.roomId, call.password);

  return (
    <div className="invite" ref={ref}>
      <button className="btn small-btn" onClick={() => setOpen((v) => !v)}>
        <UserPlus size={15} /> {t('call.invite')}
      </button>
      {open && (
        <div className="popover">
          <div className="label">{t('call.inviteLink')}</div>
          <div className="copy-row">
            <input className="field mono" readOnly value={link} onFocus={(e) => e.target.select()} />
            <CopyButton text={link} title={t('call.copyLink')} />
          </div>
          <div className="pair">
            <div>
              <div className="label">{t('call.roomId')}</div>
              <div className="room-name big-mono">{call.roomId}</div>
            </div>
            <div>
              <div className="label">{t('call.password')}</div>
              <div className="mono big-mono">{call.password}</div>
            </div>
          </div>
          <p className="muted small">{t('call.inviteNote')}</p>
        </div>
      )}
    </div>
  );
}

/** Tells everyone in the call which profile picture we use (and when it changes). */
function AvatarSync() {
  const { localParticipant } = useLocalParticipant();
  const connection = useConnectionState();
  const avatar = useStore((s) => s.avatar);
  useEffect(() => {
    if (connection === ConnectionState.Connected) void setPresence(localParticipant, { avatar });
  }, [connection, localParticipant, avatar]);
  return null;
}

/** Join / leave chimes for other people. */
function CallSounds() {
  const room = useRoomContext();
  useEffect(() => {
    const join = () => sounds.join();
    const leave = () => sounds.leave();
    const connected = () => sounds.join();
    room.on(RoomEvent.ParticipantConnected, join);
    room.on(RoomEvent.ParticipantDisconnected, leave);
    room.on(RoomEvent.Connected, connected);
    return () => {
      room.off(RoomEvent.ParticipantConnected, join);
      room.off(RoomEvent.ParticipantDisconnected, leave);
      room.off(RoomEvent.Connected, connected);
    };
  }, [room]);
  return null;
}

// ---------- in-call chat (lives only as long as the call; nothing is stored) ----------

const URL_RE = /(https?:\/\/[^\s<]+[^\s<.,:;"')\]!?])/g;
function linkify(text: string): ReactNode[] {
  return text.split(URL_RE).map((part, i) =>
    i % 2 === 1 ? (
      <a key={i} href={part} target="_blank" rel="noreferrer noopener">
        {part}
      </a>
    ) : (
      <Fragment key={i}>{part}</Fragment>
    ),
  );
}

function ChatPanel({ chat, onClose }: { chat: ReturnType<typeof useChat>; onClose: () => void }) {
  const [text, setText] = useState('');
  const t = useT();
  const lang = useStore((s) => s.lang);
  const timeFmt = useMemo(() => new Intl.DateTimeFormat(lang === 'tr' ? 'tr-TR' : 'en-GB', { hour: '2-digit', minute: '2-digit' }), [lang]);
  const list = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (list.current) list.current.scrollTop = list.current.scrollHeight;
  }, [chat.chatMessages.length]);

  const send = async (e: FormEvent) => {
    e.preventDefault();
    const msg = text.trim();
    if (!msg) return;
    setText('');
    try {
      await chat.send(msg);
    } catch {
      useStore.getState().setNotice(t('chat.notSent'));
    }
  };

  return (
    <aside className="chat-panel">
      <header>
        <strong>{t('chat.title')}</strong>
        <span className="muted small">{t('chat.subtitle')}</span>
        <div className="spacer" />
        <IconButton label={t('chat.close')} onClick={onClose}>
          <X size={16} />
        </IconButton>
      </header>
      <div className="chat-list" ref={list}>
        {chat.chatMessages.length === 0 && <p className="muted small center">{t('chat.empty')}</p>}
        {chat.chatMessages.map((m, i) => {
          const prev = chat.chatMessages[i - 1];
          const grouped = prev && prev.from?.identity === m.from?.identity && m.timestamp - prev.timestamp < 120_000;
          return (
            <div key={m.id ?? i} className={`chat-msg${grouped ? ' grouped' : ''}`}>
              {!grouped && (
                <div className="chat-head">
                  <strong>{m.from?.isLocal ? t('common.you') : m.from?.name || t('common.someone')}</strong>
                  <span className="muted small">{timeFmt.format(m.timestamp)}</span>
                </div>
              )}
              <div className="chat-text">{linkify(m.message)}</div>
            </div>
          );
        })}
      </div>
      <form className="chat-input" onSubmit={send}>
        <input className="field" value={text} onChange={(e) => setText(e.target.value)} placeholder={t('chat.placeholder')} autoFocus />
        <IconButton label={t('chat.send')} onClick={() => {}} disabled={!text.trim()}>
          <Send size={16} />
        </IconButton>
      </form>
    </aside>
  );
}
