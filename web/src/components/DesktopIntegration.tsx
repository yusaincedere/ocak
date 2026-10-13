import { useConnectionState, useLocalParticipant, useParticipants } from '@livekit/components-react';
import { ConnectionState, createLocalAudioTrack, Track } from 'livekit-client';
import { useEffect } from 'react';
import { leaveCall, roomOptions } from '../call';
import { desktop, type CallSnapshot } from '../desktop-bridge';
import { useStore } from '../store';
import { useDeafen, useToggleMute } from './VoiceControls';

/** True when the desktop app is in push-to-talk mode with a key bound. */
export function usePushToTalk() {
  const s = useStore((st) => st.desktopSettings);
  return !!(desktop && s?.pushToTalk && s.pttBinding);
}

/** Load desktop settings once at startup (outside any call). */
export function useDesktopSettingsLoader() {
  useEffect(() => {
    desktop
      ?.getSettings()
      .then((s) => s && useStore.getState().setDesktopSettings(s))
      .catch(() => {});
  }, []);
}

/**
 * Lives inside <LiveKitRoom>. Wires the desktop app into the call:
 * push-to-talk, mute/deafen/leave from the tray, overlay and global shortcut,
 * and keeps the overlay + tray showing who's talking.
 */
export function DesktopIntegration({ roomId }: { roomId: string }) {
  const ptt = usePushToTalk();
  const { localParticipant } = useLocalParticipant();
  const participants = useParticipants();
  const connection = useConnectionState();
  const deafened = useStore((s) => s.deafened);
  const toggleMute = useToggleMute();
  const toggleDeafen = useDeafen();

  // Tray / overlay / shortcut actions.
  useEffect(
    () =>
      desktop?.onCallAction((action) => {
        if (action === 'toggle-mute') toggleMute();
        else if (action === 'toggle-deafen') toggleDeafen();
        else if (action === 'leave') leaveCall();
      }),
    [toggleMute, toggleDeafen],
  );

  // Overlay + tray snapshot.
  useEffect(() => {
    if (!desktop) return;
    if (connection !== ConnectionState.Connected) return;
    const snap: CallSnapshot = {
      roomId,
      muted: !localParticipant.isMicrophoneEnabled && !ptt,
      deafened,
      participants: participants.map((p) => ({
        id: p.identity,
        name: p.name || 'Someone',
        speaking: p.isSpeaking,
        muted: !p.isMicrophoneEnabled,
        isLocal: p.isLocal,
        sharing: p.isScreenShareEnabled,
      })),
    };
    desktop.setCallState(snap);
  });
  useEffect(() => () => desktop?.setCallState(null), []);

  // In PTT mode, publish the mic track *muted* as soon as we connect, so the first
  // key press unmutes instantly instead of waiting for the microphone to start.
  useEffect(() => {
    if (!ptt || connection !== ConnectionState.Connected) return;
    const pub = localParticipant.getTrackPublication(Track.Source.Microphone);
    if (pub?.track) {
      void pub.mute();
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const track = await createLocalAudioTrack(roomOptions.audioCaptureDefaults);
        await track.mute();
        if (cancelled) return track.stop();
        await localParticipant.publishTrack(track, { source: Track.Source.Microphone });
      } catch (err) {
        console.warn(err);
        useStore.getState().setNotice('Could not start your microphone for push-to-talk.');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ptt, connection, localParticipant]);

  useEffect(() => {
    if (!desktop || !ptt) return;
    const off = desktop.onPushToTalk((down) => {
      const s = useStore.getState();
      if (s.deafened) return;
      s.setPttActive(down);
      void localParticipant.setMicrophoneEnabled(down);
    });
    return () => {
      off();
      useStore.getState().setPttActive(false);
    };
  }, [ptt, localParticipant]);

  return null;
}
