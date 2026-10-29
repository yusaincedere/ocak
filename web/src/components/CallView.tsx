import {
  LiveKitRoom,
  useConnectionState,
  useLocalParticipant,
  useParticipants,
  useRoomContext,
} from '@livekit/components-react';
import { ConnectionState, RoomEvent } from 'livekit-client';
import { useEffect, useRef, useState } from 'react';
import { leaveCall, roomOptions } from '../call';
import { desktop } from '../desktop-bridge';
import { useLolMeta } from '../lol';
import { translate, useT } from '../i18n';
import { roomLink } from '../links';
import { assignColors, resetColors, setPresence } from '../presence';
import { sounds } from '../sounds';
import { useStore, type Call } from '../store';
import { CallAudio, NoiseReductionSync } from './CallAudio';
import { ChatPanel, useCallChat, useChatSound } from './Chat';
import { DesktopIntegration, usePushToTalk } from './DesktopIntegration';
import { DesktopSettings } from './DesktopSettings';
import { LolPanel } from './LolPanel';
import { PostGameCard, usePostGame } from './PostGame';
import { CopyButton, NameChip } from './Home';
import { Chat, Gear, LolLogo, UserPlus } from './Icons';
import { VolumeMenu } from './VolumeMenu';
import { SharerControl, ViewerControl } from './RemoteControl';
import { ScreenPicker } from './ScreenPicker';
import { Stage } from './Stage';
import { CameraButton, DeafenButton, IconButton, LeaveButton, MicButton, ScreenShareButton } from './VoiceControls';

export function CallView({ call }: { call: Call }) {
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
      <CallAudio />
      <NoiseReductionSync />
      <VolumeMenu />
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
  // One side panel at a time: chat or the LoL helper.
  const [panel, setPanel] = useState<'chat' | 'lol' | null>(null);
  const chatOpen = panel === 'chat';
  const lolMeta = useLolMeta();
  const postGame = usePostGame();
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Everyone gets their own color before anything below draws an avatar or a message.
  assignColors(participants.map((p) => p.identity));
  useEffect(() => resetColors, []);
  const chat = useCallChat();
  const [seen, setSeen] = useState(0);
  const t = useT();

  // Count unread chat while the panel is closed; a sound for messages from others.
  useChatSound(chat.items, chatOpen);
  useEffect(() => {
    if (chatOpen) setSeen(chat.items.length);
  }, [chat.items, chatOpen]);
  const unread = chatOpen ? 0 : chat.items.filter((m, i) => i >= seen && !m.isLocal).length;

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
        <IconButton label={t('common.settings')} onClick={() => setSettingsOpen(true)}>
          <Gear />
        </IconButton>
      </header>

      <div className="call-body">
        <div className="stage-wrap">
          {connection === ConnectionState.Connected && participants.length === 1 && <AloneHint call={call} />}
          <Stage />
          <ViewerControl />
          {desktop && <SharerControl />}
        </div>
        {chatOpen && <ChatPanel chat={chat} onClose={() => setPanel(null)} />}
        {panel === 'lol' && lolMeta?.enabled && <LolPanel meta={lolMeta} onClose={() => setPanel(null)} />}
      </div>

      <footer className="controls">
        <MicButton />
        <DeafenButton />
        <CameraButton />
        <ScreenShareButton />
        <IconButton label={chatOpen ? t('controls.hideChat') : t('controls.chat')} active={chatOpen} onClick={() => setPanel((v) => (v === 'chat' ? null : 'chat'))} className="chat-btn">
          <Chat />
          {unread > 0 && <span className="badge">{unread > 9 ? '9+' : unread}</span>}
        </IconButton>
        {lolMeta?.enabled && (
          <IconButton label={t('lol.title')} active={panel === 'lol'} onClick={() => setPanel((v) => (v === 'lol' ? null : 'lol'))} className="lol-btn">
            <LolLogo />
          </IconButton>
        )}
        <LeaveButton />
      </footer>

      {settingsOpen && <DesktopSettings onClose={() => setSettingsOpen(false)} />}
      {postGame.shown && <PostGameCard match={postGame.shown} friends={postGame.friends} night={postGame.night} onClose={postGame.close} />}
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
  const riot = useStore((s) => s.riot);
  useEffect(() => {
    if (connection === ConnectionState.Connected) void setPresence(localParticipant, { avatar, riot });
  }, [connection, localParticipant, avatar, riot]);
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
