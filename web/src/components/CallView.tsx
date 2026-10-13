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
import { Fragment, useEffect, useLayoutEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { leaveCall, roomOptions } from '../call';
import { desktop } from '../desktop-bridge';
import { roomLink } from '../links';
import { sounds } from '../sounds';
import { useStore, type Call } from '../store';
import { DesktopIntegration, usePushToTalk } from './DesktopIntegration';
import { DesktopSettings } from './DesktopSettings';
import { CopyButton, NameChip } from './Home';
import { Chat, Gear, Send, UserPlus, X } from './Icons';
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
          useStore.getState().setNotice('You were disconnected from the call.');
        }
      }}
      onError={(err) => {
        // Errors after we pressed leave are just the connection closing.
        if (useStore.getState().call) useStore.getState().setNotice(`Call problem: ${err.message}`);
      }}
      onMediaDeviceFailure={() => useStore.getState().setNotice('Your microphone or camera is blocked or used by another app.')}
    >
      <RoomAudioRenderer muted={deafened} />
      <DesktopIntegration roomId={call.roomId} />
      <CallSounds />
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
      ? 'Connecting…'
      : connection === ConnectionState.Reconnecting || connection === ConnectionState.SignalReconnecting
        ? 'Reconnecting…'
        : null;

  return (
    <>
      <header className="call-top">
        <div className="call-room">
          <span className="mono">{call.roomId}</span>
          <InviteButton call={call} />
        </div>
        <span className="muted small">
          {status ?? `${participants.length} in call`}
        </span>
        <div className="spacer" />
        <NameChip onRename={(n) => void localParticipant.setName(n).catch(() => {})} />
        {desktop && (
          <IconButton label="Settings" onClick={() => setSettingsOpen(true)}>
            <Gear />
          </IconButton>
        )}
      </header>

      <div className="call-body">
        <div className="stage-wrap">
          {connection === ConnectionState.Connected && participants.length === 1 && <AloneHint call={call} />}
          <Stage />
        </div>
        {chatOpen && <ChatPanel chat={chat} onClose={() => setChatOpen(false)} />}
      </div>

      <footer className="controls">
        <MicButton />
        <DeafenButton />
        <CameraButton />
        <ScreenShareButton />
        <IconButton label={chatOpen ? 'Hide chat' : 'Chat'} active={chatOpen} onClick={() => setChatOpen((v) => !v)} className="chat-btn">
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
  return (
    <div className="alone">
      <span>You’re the only one here.</span>
      <CopyButton text={roomLink(call.roomId, call.password)} title="Copy invite link" label="Copy invite link" />
    </div>
  );
}

function InviteButton({ call }: { call: Call }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
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
        <UserPlus size={15} /> Invite
      </button>
      {open && (
        <div className="popover">
          <div className="label">Invite link</div>
          <div className="copy-row">
            <input className="field mono" readOnly value={link} onFocus={(e) => e.target.select()} />
            <CopyButton text={link} title="Copy link" />
          </div>
          <div className="pair">
            <div>
              <div className="label">Room ID</div>
              <div className="mono big-mono">{call.roomId}</div>
            </div>
            <div>
              <div className="label">Password</div>
              <div className="mono big-mono">{call.password}</div>
            </div>
          </div>
          <p className="muted small">Anyone with the link can join. No account needed.</p>
        </div>
      )}
    </div>
  );
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
const timeFmt = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });

function ChatPanel({ chat, onClose }: { chat: ReturnType<typeof useChat>; onClose: () => void }) {
  const [text, setText] = useState('');
  const list = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (list.current) list.current.scrollTop = list.current.scrollHeight;
  }, [chat.chatMessages.length]);

  const send = async (e: FormEvent) => {
    e.preventDefault();
    const t = text.trim();
    if (!t) return;
    setText('');
    try {
      await chat.send(t);
    } catch {
      useStore.getState().setNotice('Message not sent');
    }
  };

  return (
    <aside className="chat-panel">
      <header>
        <strong>Chat</strong>
        <span className="muted small">Only people in this call see it</span>
        <div className="spacer" />
        <IconButton label="Close chat" onClick={onClose}>
          <X size={16} />
        </IconButton>
      </header>
      <div className="chat-list" ref={list}>
        {chat.chatMessages.length === 0 && <p className="muted small center">No messages yet.</p>}
        {chat.chatMessages.map((m, i) => {
          const prev = chat.chatMessages[i - 1];
          const grouped = prev && prev.from?.identity === m.from?.identity && m.timestamp - prev.timestamp < 120_000;
          return (
            <div key={m.id ?? i} className={`chat-msg${grouped ? ' grouped' : ''}`}>
              {!grouped && (
                <div className="chat-head">
                  <strong>{m.from?.isLocal ? 'You' : (m.from?.name ?? 'Someone')}</strong>
                  <span className="muted small">{timeFmt.format(m.timestamp)}</span>
                </div>
              )}
              <div className="chat-text">{linkify(m.message)}</div>
            </div>
          );
        })}
      </div>
      <form className="chat-input" onSubmit={send}>
        <input className="field" value={text} onChange={(e) => setText(e.target.value)} placeholder="Message" autoFocus />
        <IconButton label="Send" onClick={() => {}} disabled={!text.trim()}>
          <Send size={16} />
        </IconButton>
      </form>
    </aside>
  );
}
