import {
  LiveKitRoom,
  useConnectionState,
  useLocalParticipant,
  useParticipants,
  useRoomContext,
} from '@livekit/components-react';
import type { LolRole } from '../../../server/src/protocol';
import { ChampionRoulette } from './ChampionRoulette';
import { ConnectionState, DisconnectReason, RoomEvent } from 'livekit-client';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { mediaErrorKey } from '../media-errors';
import { api, ApiError } from '../api';
import { leaveCall, rejoinCall, roomOptions } from '../call';
import { desktop } from '../desktop-bridge';
import { useLolMeta } from '../lol';
import { useNarrow } from '../narrow';
import { translate, useT } from '../i18n';
import { roomLink } from '../links';
import { assignColors, deviceOf, resetColors, setPresence } from '../presence';
import { sounds } from '../sounds';
import { useStore, type Call } from '../store';
import { CallAudio, NoiseReductionSync } from './CallAudio';
import { ChatPanel, useCallChat, useChatSound } from './Chat';
import { usePrivateChats } from './PrivateChat';
import { DesktopIntegration, usePushToTalk } from './DesktopIntegration';
import { DesktopSettings } from './DesktopSettings';
import { LolPanel } from './LolPanel';
import { PostGameCard, usePostGame } from './PostGame';
import { CopyButton, NameChip } from './Home';
import { Dice, Gear, LolLogo, More, UserPlus, Wolf } from './Icons';
import { VolumeMenu } from './VolumeMenu';
import { SharerControl, ViewerControl } from './RemoteControl';
import { ScreenPicker } from './ScreenPicker';
import { Stage } from './Stage';
import { CameraButton, DeafenButton, IconButton, LeaveButton, MicButton, ScreenShareButton } from './VoiceControls';

export function CallView({ call }: { call: Call }) {
  const ptt = usePushToTalk();
  const t = useT();
  const [disconnected, setDisconnected] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);
  useEffect(() => { setDisconnected(false); setRetrying(false); setRetryError(null); }, [call.token]);

  const retry = async () => {
    if (retrying) return;
    setRetrying(true);
    setRetryError(null);
    try {
      await rejoinCall(call.roomId, call.password);
    } catch (err) {
      setRetryError(err instanceof ApiError ? err.message : translate('call.failed'));
      setRetrying(false);
    }
  };

  return (
    <>
    <LiveKitRoom
      key={call.token}
      className="call"
      serverUrl={call.url}
      token={call.token}
      connect
      audio={!ptt} // in push-to-talk mode DesktopIntegration publishes the mic muted
      video={false}
      options={roomOptions}
      onDisconnected={(reason) => {
        // Still "in" the call in our state = we didn't press leave.
        if (useStore.getState().call?.token !== call.token) return;
        // An admin removed us or ended the call: nothing to retry.
        if (reason === DisconnectReason.PARTICIPANT_REMOVED || reason === DisconnectReason.ROOM_DELETED) {
          leaveCall();
          useStore.getState().setNotice(translate(reason === DisconnectReason.ROOM_DELETED ? 'admin.callEnded' : 'admin.youWereRemoved'));
          return;
        }
        setDisconnected(true);
      }}
      onError={(err) => {
        // Errors after we pressed leave are just the connection closing.
        if (useStore.getState().call?.token === call.token) useStore.getState().setNotice(translate(mediaErrorKey(err)));
      }}
      onMediaDeviceFailure={(failure) => useStore.getState().setNotice(translate(mediaErrorKey({ name: failure ?? 'Other' })))}
    >
      <CallAudio />
      <NoiseReductionSync />
      <DesktopIntegration roomId={call.roomId} />
      <CallSounds />
      <AvatarSync />
      <ScreenPicker />
      <CallLayout call={call} />
    </LiveKitRoom>
    {disconnected && <div className="call-recovery" role="alertdialog" aria-label={t('call.disconnected')}>
      <div className="call-recovery-card">
        <h2>{t('call.disconnected')}</h2>
        <p>{t('call.recoveryHint')}</p>
        {retryError && <p className="form-error" role="alert">{retryError}</p>}
        <div className="call-recovery-actions">
          <button type="button" className="btn primary" disabled={retrying} onClick={() => void retry()}>{t(retrying ? 'call.retrying' : 'call.retry')}</button>
          <button type="button" className="btn subtle" onClick={leaveCall}>{t('call.leave')}</button>
        </div>
      </div>
    </div>}
    </>
  );
}

function CallLayout({ call }: { call: Call }) {
  const participants = useParticipants();
  const connection = useConnectionState();
  const { localParticipant } = useLocalParticipant();
  const [panel, setPanel] = useState<'lol' | null>(null);
  const [chatCollapsed, setChatCollapsed] = useState(false);
  const [rouletteOpen, setRouletteOpen] = useState(false);
  const [roulettePick, setRoulettePick] = useState<{ id: string; lane?: LolRole } | null>(null);
  const chatOpen = !chatCollapsed;
  const lolMeta = useLolMeta();
  const postGame = usePostGame();
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Everyone gets their own color before anything below draws an avatar or a message.
  assignColors(participants.map((p) => p.identity));
  useEffect(() => resetColors, []);
  const chat = useCallChat();
  const privateChats = usePrivateChats(participants);
  const [seen, setSeen] = useState(0);
  const t = useT();
  const narrow = useNarrow();

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

  const funControls = (
    <>
      <IconButton label={t(lolMeta?.enabled ? 'roulette.title' : 'roulette.unavailable')} active={rouletteOpen} disabled={!lolMeta?.enabled} onClick={() => setRouletteOpen(true)} className="roulette-btn">
        <Dice />
      </IconButton>
      {lolMeta?.enabled && (
        <IconButton label={t('lol.title')} active={panel === 'lol'} onClick={() => setPanel((v) => (v === 'lol' ? null : 'lol'))} className="lol-btn">
          <LolLogo />
        </IconButton>
      )}
    </>
  );

  return (
    <>
      <header className="call-top">
        <div className="call-room">
          <Wolf size={22} className="call-mark" />
          <span className="room-name">{call.roomId}</span>
          {call.password !== null && <InviteButton call={call} password={call.password} />}
        </div>
        <span className="call-status muted small">
          {status ?? t('call.inCall', { n: participants.length })}
        </span>
        <div className="spacer" />
        {call.admin && <EndForAll roomId={call.roomId} />}
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
        <div className="chat-stack">
          {privateChats.list.map((p) => (
            <ChatPanel
              key={p.device}
              chat={p.chat}
              title={p.name}
              accent={p.color}
              collapsed={p.collapsed}
              unread={p.unread}
              onToggle={() => privateChats.toggle(p.device)}
              onClose={() => privateChats.close(p.device)}
              blocked={p.online ? null : t('private.left', { name: p.name })}
              emptyText={t('private.empty')}
              focusRequest={p.focusRequest}
            />
          ))}
          <ChatPanel
            chat={chat}
            title={t('chat.title')}
            collapsed={chatCollapsed}
            unread={unread}
            onToggle={() => setChatCollapsed((value) => !value)}
            onName={(m) => privateChats.open(deviceOf(m.identity), m.name)}
            quietWhenIdle
          />
        </div>
        {panel === 'lol' && lolMeta?.enabled && <LolPanel meta={lolMeta} initialPick={roulettePick} onClose={() => setPanel(null)} />}
      </div>

      <footer className="controls">
        <MicButton />
        <DeafenButton />
        {narrow ? <ScreenShareButton /> : <CameraButton />}
        {narrow ? (
          <MoreControls active={panel === 'lol'}>
            <CameraButton />
            {funControls}
          </MoreControls>
        ) : (
          <>
            <ScreenShareButton />
            {funControls}
          </>
        )}
        <LeaveButton />
      </footer>

      <VolumeMenu onMessage={privateChats.open} />
      {rouletteOpen && lolMeta?.enabled && <ChampionRoulette meta={lolMeta} onLanded={(champion) => void chat.announceRoulette(champion)} onClose={() => setRouletteOpen(false)} onPick={(id, lane) => {
        setRoulettePick({ id, lane });
        setPanel('lol');
      }} />}
      {settingsOpen && <DesktopSettings onClose={() => setSettingsOpen(false)} />}
      {postGame.shown && <PostGameCard match={postGame.shown} friends={postGame.friends} night={postGame.night} onClose={postGame.close} />}
    </>
  );
}

/** In a narrow window the less urgent buttons wait behind this one, so the main ones never clip. */
function MoreControls({ active, children }: { active: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const t = useT();
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);
  return (
    <div className="controls-more" ref={ref}>
      <IconButton label={t('controls.more')} active={open || active} onClick={() => setOpen((v) => !v)}>
        <More />
      </IconButton>
      {open && (
        <div
          className="controls-more-menu"
          onClick={(e) => (e.target as HTMLElement).closest('.icon-btn') && setOpen(false)}
        >
          {children}
        </div>
      )}
    </div>
  );
}

function AloneHint({ call }: { call: Call }) {
  const t = useT();
  return (
    <div className="alone">
      <span>{t('call.alone')}</span>
      {call.password !== null && (
        <CopyButton text={roomLink(call.roomId, call.password)} title={t('home.copyInvite')} label={t('home.copyInvite')} />
      )}
    </div>
  );
}

/** Admins only: disconnects everyone (the room itself stays). */
function EndForAll({ roomId }: { roomId: string }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  return (
    <button
      className="btn small-btn danger"
      disabled={busy}
      onClick={() => {
        if (!window.confirm(t('admin.endConfirm', { room: roomId }))) return;
        setBusy(true);
        api.admin
          .endCall(roomId)
          .catch((err: unknown) => useStore.getState().setNotice(err instanceof Error ? err.message : translate('common.somethingWrong')))
          .finally(() => setBusy(false));
      }}
    >
      {t('admin.endCall')}
    </button>
  );
}

function InviteButton({ call, password }: { call: Call; password: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const t = useT();
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [open]);
  const link = roomLink(call.roomId, password);

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
              <div className="mono big-mono">{password}</div>
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
  const nameStyle = useStore((s) => s.nameStyle);
  useEffect(() => {
    if (connection === ConnectionState.Connected) void setPresence(localParticipant, { avatar, riot, nameStyle });
  }, [connection, localParticipant, avatar, riot, nameStyle]);
  return null;
}

/** Distinct call cues, including reconnects; never double-chime for one interruption. */
function CallSounds() {
  const room = useRoomContext();
  const enabled = useStore((s) => s.callSound);
  const interrupted = useRef(false);
  useEffect(() => {
    const join = () => { if (enabled) sounds.join(); };
    const leave = () => { if (enabled) sounds.leave(); };
    const connected = () => { if (enabled) sounds.join(); };
    const lost = () => {
      if (interrupted.current) return;
      interrupted.current = true;
      if (enabled) sounds.connectionLost();
    };
    const restored = () => {
      if (!interrupted.current) return;
      interrupted.current = false;
      if (enabled) sounds.connectionRestored();
    };
    const disconnected = () => {
      if (useStore.getState().call && !interrupted.current) lost();
    };
    room.on(RoomEvent.ParticipantConnected, join);
    room.on(RoomEvent.ParticipantDisconnected, leave);
    room.on(RoomEvent.Connected, connected);
    room.on(RoomEvent.Reconnecting, lost);
    room.on(RoomEvent.Reconnected, restored);
    room.on(RoomEvent.Disconnected, disconnected);
    return () => {
      room.off(RoomEvent.ParticipantConnected, join);
      room.off(RoomEvent.ParticipantDisconnected, leave);
      room.off(RoomEvent.Connected, connected);
      room.off(RoomEvent.Reconnecting, lost);
      room.off(RoomEvent.Reconnected, restored);
      room.off(RoomEvent.Disconnected, disconnected);
    };
  }, [room, enabled]);
  return null;
}
