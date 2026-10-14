import { MediaDeviceMenu, useLocalParticipant, useTrackToggle } from '@livekit/components-react';
import { Track } from 'livekit-client';
import { useCallback, type ReactNode } from 'react';
import { leaveCall, screenShareOptions } from '../call';
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
  useStore.getState().setNotice(translate('controls.deviceError', { device, message: err.message }));
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
  const { enabled, pending, toggle } = useTrackToggle({
    source: Track.Source.ScreenShare,
    captureOptions: screenShareOptions,
    onDeviceError: (err) => {
      // Cancelling the picker is not an error worth showing. The desktop app reports every
      // refusal as an AbortError and tells us the real reason itself (see ScreenPicker).
      if (err.name === 'NotAllowedError' || (err.name === 'AbortError' && desktop?.onShareError)) return;
      reportDeviceError('screen')(err);
    },
  });
  const t = useT();
  return (
    <IconButton label={enabled ? t('controls.stopSharing') : t('controls.shareScreen')} active={enabled} disabled={pending} onClick={() => void toggle()}>
      <Screen />
    </IconButton>
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
