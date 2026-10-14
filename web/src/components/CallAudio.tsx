import { AudioTrack, useLocalParticipant, useTracks } from '@livekit/components-react';
import { Track, type LocalAudioTrack } from 'livekit-client';
import { useEffect, useState } from 'react';
import { translate } from '../i18n';
import { AudioNotAllowedYet, NOISE_PROCESSOR, NoiseReduction } from '../noise';
import { deviceOf } from '../presence';
import { useStore } from '../store';

/**
 * Plays everyone else's audio (voice and shared-screen sound), each at the volume you
 * picked for that friend. Deafen mutes all of it.
 * Volumes above 100% work because the room mixes audio through Web Audio (see call.ts).
 */
export function CallAudio() {
  const deafened = useStore((s) => s.deafened);
  const volumes = useStore((s) => s.volumes);
  const tracks = useTracks([Track.Source.Microphone, Track.Source.ScreenShareAudio, Track.Source.Unknown], {
    updateOnlyOn: [],
    onlySubscribed: true,
  }).filter((ref) => !ref.participant.isLocal && ref.publication.kind === Track.Kind.Audio);

  return (
    <div style={{ display: 'none' }}>
      {tracks.map((ref) => (
        <AudioTrack
          key={`${ref.participant.identity}:${ref.publication.trackSid}`}
          trackRef={ref}
          volume={volumes[deviceOf(ref.participant.identity)] ?? 1}
          muted={deafened}
        />
      ))}
    </div>
  );
}

/** Keeps noise reduction on your microphone in line with the setting. */
export function NoiseReductionSync() {
  const enabled = useStore((s) => s.noiseReduction);
  const { microphoneTrack } = useLocalParticipant();
  const track = microphoneTrack?.track as LocalAudioTrack | undefined;
  // Bumped after a click when the browser wasn't ready to process audio yet.
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    if (!track) return;
    let cancelled = false;
    let onGesture: (() => void) | null = null;
    void (async () => {
      const active = track.getProcessor()?.name === NOISE_PROCESSOR;
      try {
        if (enabled && !active) await track.setProcessor(new NoiseReduction());
        else if (!enabled && active) await track.stopProcessor();
      } catch (err) {
        if (cancelled) return;
        if (err instanceof AudioNotAllowedYet) {
          // Joined without clicking anything (e.g. an invite link): try again on the first click.
          onGesture = () => setRetry((n) => n + 1);
          window.addEventListener('pointerdown', onGesture, { once: true });
        } else {
          console.warn('Noise reduction unavailable', err);
          useStore.getState().setNotice(translate('audio.noiseUnavailable'));
        }
      }
    })();
    return () => {
      cancelled = true;
      if (onGesture) window.removeEventListener('pointerdown', onGesture);
    };
  }, [track, enabled, retry]);

  return null;
}
