import { MediaDeviceMenu, useLocalParticipant, useTrackToggle } from '@livekit/components-react';
import { Track } from 'livekit-client';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { mediaErrorKey } from '../media-errors';
import { leaveCall } from '../call';
import { getShareQuality, saveShareQuality, shareSettings, SHARE_QUALITIES, type ShareQuality } from '../share-quality';
import { desktop } from '../desktop-bridge';
import { translate, useT, type MessageKey } from '../i18n';
import { setPresence } from '../presence';
import { sounds } from '../sounds';
import { useStore } from '../store';
import { Headphones, HeadphonesOff, Mic, MicOff, PhoneOff, Screen, Video } from './Icons';

export function IconButton({
  label,
  active,
  danger,
  off,
  disabled,
  onClick,
  children,
  className = '',
}: {
  label: string;
  active?: boolean;
  danger?: boolean;
  off?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      className={`icon-btn${active ? ' active' : ''}${danger ? ' danger' : ''}${off ? ' off' : ''} ${className}`}
      title={label}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

type Device = 'microphone' | 'camera' | 'screen';
const reportDeviceError = (what: Device) => (err: Error) => {
  console.warn(err);
  const device = translate(`controls.device.${what}` as MessageKey);
  useStore.getState().setNotice(translate('controls.deviceError', { device, message: translate(mediaErrorKey(err)) }));
};

// Deafen also mutes the mic and remembers whether to turn it back on (like Discord).
let micWasOn = false;

export function useDeafen() {
  const { localParticipant } = useLocalParticipant();
  return useCallback(() => {
    const { deafened, setDeafened } = useStore.getState();
    if (!deafened) {
      micWasOn = localParticipant.isMicrophoneEnabled;
      setDeafened(true);
      void localParticipant.setMicrophoneEnabled(false);
      void setPresence(localParticipant, { deafened: true });
      sounds.mute();
    } else {
      setDeafened(false);
      void setPresence(localParticipant, { deafened: false });
      if (micWasOn) void localParticipant.setMicrophoneEnabled(true);
      sounds.unmute();
    }
  }, [localParticipant]);
}

export function useToggleMute() {
  const { localParticipant } = useLocalParticipant();
  const toggleDeafen = useDeafen();
  return useCallback(() => {
    if (useStore.getState().deafened) return toggleDeafen(); // unmuting while deafened undeafens
    const on = !localParticipant.isMicrophoneEnabled;
    void localParticipant.setMicrophoneEnabled(on);
    (on ? sounds.unmute : sounds.mute)();
  }, [localParticipant, toggleDeafen]);
}

export function MicButton() {
  const { enabled, pending } = useTrackToggle({
    source: Track.Source.Microphone,
    onDeviceError: reportDeviceError('microphone'),
  });
  const toggle = useToggleMute();
  const t = useT();
  return (
    <div className="device-group">
      <IconButton label={enabled ? t('controls.mute') : t('controls.unmute')} off={!enabled} disabled={pending} onClick={toggle}>
        {enabled ? <Mic /> : <MicOff />}
      </IconButton>
      <MediaDeviceMenu kind="audioinput" title={t('controls.microphone')} />
    </div>
  );
}

export function CameraButton() {
  const { enabled, pending, toggle } = useTrackToggle({
    source: Track.Source.Camera,
    onDeviceError: reportDeviceError('camera'),
  });
  const t = useT();
  return (
    <div className="device-group">
      <IconButton label={enabled ? t('controls.cameraOff') : t('controls.cameraOn')} active={enabled} disabled={pending} onClick={() => void toggle()}>
        <Video />
      </IconButton>
      <MediaDeviceMenu kind="videoinput" title={t('controls.camera')} />
    </div>
  );
}

export function ScreenShareButton() {
  const { localParticipant } = useLocalParticipant();
  const [pending, setPending] = useState(false);
  const [open, setOpen] = useState(false);
  const [quality, setQuality] = useState(getShareQuality);
  const ref = useRef<HTMLDivElement>(null);
  const enabled = localParticipant.isScreenShareEnabled;
  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const escape = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
  }, [open]);
  const t = useT();
  const start = async (selected: ShareQuality) => {
    setQuality(selected);
    saveShareQuality(selected);
    setOpen(false);
    setPending(true);
    try {
      const { capture, publish } = shareSettings(selected);
      await localParticipant.setScreenShareEnabled(true, capture, publish);
    } catch (err) {
      if (err instanceof Error && (err.name === 'NotAllowedError' || (err.name === 'AbortError' && desktop?.onShareError))) return;
      reportDeviceError('screen')(err instanceof Error ? err : new Error('screen share failed'));
    } finally { setPending(false); }
  };
  return (
    <div className="share-quality-control" ref={ref}>
      <IconButton label={enabled ? t('controls.stopSharing') : t('controls.shareScreen')} active={enabled} disabled={pending} onClick={() => {
        if (enabled) {
          setPending(true);
          void localParticipant.setScreenShareEnabled(false).catch(reportDeviceError('screen')).finally(() => setPending(false));
        } else setOpen((value) => !value);
      }}><Screen /></IconButton>
      {open && <div className="share-quality-menu" role="group" aria-label={t('share.quality')}>
        {SHARE_QUALITIES.map((choice) => <button type="button" key={choice} aria-current={choice === quality ? 'true' : undefined}
          onClick={() => void start(choice)}>
          <strong>{t(`share.${choice}`)}</strong><small>{t(`share.${choice}Hint`)}</small>
        </button>)}
      </div>}
    </div>
  );
}

export function DeafenButton() {
  const deafened = useStore((s) => s.deafened);
  const toggle = useDeafen();
  const t = useT();
  return (
    <IconButton label={deafened ? t('controls.undeafen') : t('controls.deafen')} off={deafened} onClick={toggle}>
      {deafened ? <HeadphonesOff /> : <Headphones />}
    </IconButton>
  );
}

export function LeaveButton() {
  const t = useT();
  return (
    <IconButton label={t('controls.leave')} danger onClick={leaveCall} className="leave">
      <PhoneOff />
    </IconButton>
  );
}
