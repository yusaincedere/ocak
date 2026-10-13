import { MediaDeviceMenu, useLocalParticipant, useTrackToggle } from '@livekit/components-react';
import { Track } from 'livekit-client';
import { useCallback, type ReactNode } from 'react';
import { leaveCall, screenShareOptions } from '../call';
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

const reportDeviceError = (what: string) => (err: Error) => {
  console.warn(err);
  useStore.getState().setNotice(`Couldn't start your ${what}: ${err.message}`);
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
      sounds.mute();
    } else {
      setDeafened(false);
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
  return (
    <div className="device-group">
      <IconButton label={enabled ? 'Mute' : 'Unmute'} off={!enabled} disabled={pending} onClick={toggle}>
        {enabled ? <Mic /> : <MicOff />}
      </IconButton>
      <MediaDeviceMenu kind="audioinput" title="Microphone" />
    </div>
  );
}

export function CameraButton() {
  const { enabled, pending, toggle } = useTrackToggle({
    source: Track.Source.Camera,
    onDeviceError: reportDeviceError('camera'),
  });
  return (
    <div className="device-group">
      <IconButton label={enabled ? 'Turn camera off' : 'Turn camera on'} active={enabled} disabled={pending} onClick={() => void toggle()}>
        <Video />
      </IconButton>
      <MediaDeviceMenu kind="videoinput" title="Camera" />
    </div>
  );
}

export function ScreenShareButton() {
  const { enabled, pending, toggle } = useTrackToggle({
    source: Track.Source.ScreenShare,
    captureOptions: screenShareOptions,
    onDeviceError: (err) => {
      // Cancelling the picker is not an error worth showing.
      if (err.name !== 'NotAllowedError') reportDeviceError('screen share')(err);
    },
  });
  return (
    <IconButton label={enabled ? 'Stop sharing' : 'Share your screen'} active={enabled} disabled={pending} onClick={() => void toggle()}>
      <Screen />
    </IconButton>
  );
}

export function DeafenButton() {
  const deafened = useStore((s) => s.deafened);
  const toggle = useDeafen();
  return (
    <IconButton label={deafened ? 'Undeafen' : 'Deafen'} off={deafened} onClick={toggle}>
      {deafened ? <HeadphonesOff /> : <Headphones />}
    </IconButton>
  );
}

export function LeaveButton() {
  return (
    <IconButton label="Leave call" danger onClick={leaveCall} className="leave">
      <PhoneOff />
    </IconButton>
  );
}
