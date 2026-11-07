import { AudioTrack, useLocalParticipant, useParticipantAttributes, useTracks } from '@livekit/components-react';
import { Track, type LocalAudioTrack } from 'livekit-client';
import { useEffect, useState } from 'react';
import { translate } from '../i18n';
import { MicChain, type MicOptions } from '../mic';
import { AudioNotAllowedYet } from '../noise';
import { deviceOf, voiceEffectOf } from '../presence';
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

/**
 * Keeps your microphone's processing in line: noise reduction (your setting) and a voice effect
 * (set on you by an admin, for a while). Both run in one chain, see mic.ts.
 */
export function MicSync() {
  const noise = useStore((s) => s.noiseReduction);
  const voice = useVoiceEffect();
  const { microphoneTrack } = useLocalParticipant();
  const track = microphoneTrack?.track as LocalAudioTrack | undefined;
  // Bumped after a click when the browser wasn't ready to process audio yet.
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    if (!track) return;
    let cancelled = false;
    let onGesture: (() => void) | null = null;
    const opts: MicOptions = { noise, voice };
    void (async () => {
      const current = track.getProcessor();
      try {
        if (!noise && !voice) {
          if (current) await track.stopProcessor();
        } else if (current instanceof MicChain) await current.update(opts);
        else await track.setProcessor(new MicChain(opts));
      } catch (err) {
        if (cancelled) return;
        if (err instanceof AudioNotAllowedYet) {
          // Joined without clicking anything (e.g. an invite link): try again on the first click.
          onGesture = () => setRetry((n) => n + 1);
          window.addEventListener('pointerdown', onGesture, { once: true });
        } else {
          console.warn('Microphone processing unavailable', err);
          if (noise) useStore.getState().setNotice(translate('audio.noiseUnavailable'));
        }
      }
    })();
    return () => {
      cancelled = true;
      if (onGesture) window.removeEventListener('pointerdown', onGesture);
    };
  }, [track, noise, voice, retry]);

  return null;
}

/** The voice effect an admin set on you, until it runs out. */
function useVoiceEffect(): MicOptions['voice'] {
  const { localParticipant } = useLocalParticipant();
  const { attributes } = useParticipantAttributes({ participant: localParticipant });
  const effect = voiceEffectOf(attributes);
  const [, setTick] = useState(0);
  const until = effect?.until ?? 0;
  useEffect(() => {
    if (!until) return;
    // re-check when it runs out (the server also clears it then)
    const timer = setTimeout(() => setTick((n) => n + 1), Math.max(0, until - Date.now()) + 50);
    return () => clearTimeout(timer);
  }, [until]);
  return effect?.effect ?? null;
}
