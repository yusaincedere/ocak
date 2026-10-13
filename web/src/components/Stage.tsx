import {
  CarouselLayout,
  FocusLayout,
  FocusLayoutContainer,
  GridLayout,
  LayoutContextProvider,
  ParticipantTile,
  StartAudio,
  isTrackReference,
  useCreateLayoutContext,
  usePinnedTracks,
  useTracks,
  type TrackReferenceOrPlaceholder,
} from '@livekit/components-react';
import { RoomEvent, Track } from 'livekit-client';
import { useEffect, useRef } from 'react';
import { useT } from '../i18n';

const sameTrack = (a?: TrackReferenceOrPlaceholder, b?: TrackReferenceOrPlaceholder) =>
  !!a &&
  !!b &&
  a.participant.identity === b.participant.identity &&
  a.source === b.source &&
  (isTrackReference(a) ? a.publication.trackSid : null) === (isTrackReference(b) ? b.publication.trackSid : null);

/** Video tiles: a grid, or a big focused tile (e.g. a screen share) with a strip of the rest. */
export function Stage() {
  const t = useT();
  const tracks = useTracks(
    [
      { source: Track.Source.Camera, withPlaceholder: true },
      { source: Track.Source.ScreenShare, withPlaceholder: false },
    ],
    { updateOnlyOn: [RoomEvent.ActiveSpeakersChanged], onlySubscribed: false },
  );

  const layout = useCreateLayoutContext();
  const focusTrack = usePinnedTracks(layout)?.[0];
  const others = tracks.filter((t) => !sameTrack(t, focusTrack));

  // Automatically focus a new screen share; unfocus when it ends.
  const screenShares = tracks.filter(isTrackReference).filter((t) => t.publication.source === Track.Source.ScreenShare);
  const autoFocused = useRef<TrackReferenceOrPlaceholder | null>(null);
  useEffect(() => {
    const live = screenShares.find((t) => t.publication.isSubscribed || t.participant.isLocal);
    if (live && !autoFocused.current) {
      layout.pin.dispatch?.({ msg: 'set_pin', trackReference: live });
      autoFocused.current = live;
    } else if (autoFocused.current && !screenShares.some((t) => sameTrack(t, autoFocused.current!))) {
      layout.pin.dispatch?.({ msg: 'clear_pin' });
      autoFocused.current = null;
    }
    // A pinned track that disappeared (someone left) shouldn't leave an empty stage.
    if (focusTrack && !tracks.some((t) => sameTrack(t, focusTrack))) layout.pin.dispatch?.({ msg: 'clear_pin' });
  }, [screenShares.map((t) => t.publication.trackSid + t.publication.isSubscribed).join(), tracks, focusTrack, layout]);

  return (
    <div className="stage" data-lk-theme="default">
      <LayoutContextProvider value={layout}>
        <div className="stage-tiles">
          {!focusTrack ? (
            <GridLayout tracks={tracks}>
              <ParticipantTile />
            </GridLayout>
          ) : (
            <FocusLayoutContainer>
              <CarouselLayout tracks={others}>
                <ParticipantTile />
              </CarouselLayout>
              <FocusLayout trackRef={focusTrack} />
            </FocusLayoutContainer>
          )}
        </div>
      </LayoutContextProvider>

      <StartAudio label={t('call.enableAudio')} />
    </div>
  );
}
