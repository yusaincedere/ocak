import {
  CarouselLayout,
  FocusLayout,
  FocusLayoutContainer,
  GridLayout,
  LayoutContextProvider,
  ParticipantTile,
  StartAudio,
  useCreateLayoutContext,
  useParticipants,
  usePinnedTracks,
  useTracks,
  type TrackReference,
  type TrackReferenceOrPlaceholder,
} from '@livekit/components-react';
import { RoomEvent, Track } from 'livekit-client';
import { useEffect, useRef } from 'react';
import { useT } from '../i18n';
import { VoiceRoom, VoiceStrip } from './People';

const sameTrack = (a?: TrackReferenceOrPlaceholder, b?: TrackReferenceOrPlaceholder) =>
  !!a &&
  !!b &&
  a.participant.identity === b.participant.identity &&
  a.source === b.source &&
  a.publication?.trackSid === b.publication?.trackSid;

/**
 * The middle of the call.
 * - Nobody on camera or sharing → a calm voice room with everyone's avatar.
 * - Cameras / screen shares → those get the space (grid, or a focused share), and
 *   everyone else sits in a slim row underneath instead of an empty video tile.
 */
export function Stage() {
  const t = useT();
  const participants = useParticipants();
  const tracks = useTracks(
    [
      { source: Track.Source.Camera, withPlaceholder: false },
      { source: Track.Source.ScreenShare, withPlaceholder: false },
    ],
    { updateOnlyOn: [RoomEvent.ActiveSpeakersChanged, RoomEvent.TrackMuted, RoomEvent.TrackUnmuted], onlySubscribed: false },
  );
  // A turned-off camera stays published but muted: that person is voice-only.
  const videos = tracks.filter(
    (tr): tr is TrackReference => !!tr.publication && (tr.source === Track.Source.ScreenShare || !tr.publication.isMuted),
  );
  const onCamera = new Set(videos.filter((v) => v.source === Track.Source.Camera).map((v) => v.participant.identity));
  const voiceOnly = participants.filter((p) => !onCamera.has(p.identity));

  const layout = useCreateLayoutContext();
  const focusTrack = usePinnedTracks(layout)?.[0];
  const others = videos.filter((v) => !sameTrack(v, focusTrack));

  // Automatically focus a new screen share; unfocus when it ends.
  const screenShares = videos.filter((v) => v.source === Track.Source.ScreenShare);
  const autoFocused = useRef<TrackReferenceOrPlaceholder | null>(null);
  useEffect(() => {
    const live = screenShares.find((v) => v.publication.isSubscribed || v.participant.isLocal);
    if (live && !autoFocused.current) {
      layout.pin.dispatch?.({ msg: 'set_pin', trackReference: live });
      autoFocused.current = live;
    } else if (autoFocused.current && !screenShares.some((v) => sameTrack(v, autoFocused.current!))) {
      layout.pin.dispatch?.({ msg: 'clear_pin' });
      autoFocused.current = null;
    }
    // A pinned track that went away (camera off, someone left) shouldn't leave an empty stage.
    if (focusTrack && !videos.some((v) => sameTrack(v, focusTrack))) layout.pin.dispatch?.({ msg: 'clear_pin' });
  }, [screenShares.map((v) => v.publication.trackSid + v.publication.isSubscribed).join(), videos.map((v) => v.publication.trackSid).join(), focusTrack, layout]);

  return (
    <div className="stage" data-lk-theme="default">
      {videos.length === 0 ? (
        <VoiceRoom participants={participants} />
      ) : (
        <LayoutContextProvider value={layout}>
          <div className="stage-tiles">
            {!focusTrack ? (
              <GridLayout tracks={videos}>
                <ParticipantTile />
              </GridLayout>
            ) : (
              <FocusLayoutContainer>
                {others.length > 0 && (
                  <CarouselLayout tracks={others}>
                    <ParticipantTile />
                  </CarouselLayout>
                )}
                <FocusLayout trackRef={focusTrack} />
              </FocusLayoutContainer>
            )}
          </div>
          <VoiceStrip participants={voiceOnly} />
        </LayoutContextProvider>
      )}

      <StartAudio label={t('call.enableAudio')} />
    </div>
  );
}
