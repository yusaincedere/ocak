import { useIsSpeaking } from '@livekit/components-react';
import type { Participant } from 'livekit-client';
import type { CSSProperties } from 'react';
import { useT } from '../i18n';
import { colorFor, initials, isDeafened, usesPushToTalk } from '../presence';
import { HeadphonesOff, MicOff } from './Icons';

/**
 * Round avatar with the person's color, a speaking ring and a mute / deafen badge.
 * `size` in px; leave it out to take --size from the surrounding layout.
 */
export function Avatar({ participant, size }: { participant: Participant; size?: number }) {
  const speaking = useIsSpeaking(participant);
  const deafened = isDeafened(participant);
  const muted = !participant.isMicrophoneEnabled && !usesPushToTalk(participant);
  const name = participant.name || participant.identity;
  const style = { '--c': colorFor(participant.identity), ...(size ? { '--size': `${size}px` } : {}) } as CSSProperties;

  return (
    <div className={`avatar${speaking ? ' speaking' : ''}`} style={style}>
      <span className="avatar-initials">{initials(name)}</span>
      {(deafened || muted) && (
        <span className="avatar-badge">{deafened ? <HeadphonesOff /> : <MicOff />}</span>
      )}
    </div>
  );
}

function PersonName({ participant }: { participant: Participant }) {
  const t = useT();
  return (
    <span className="person-name">
      <span className="person-name-text">{participant.name || participant.identity}</span>
      {participant.isScreenShareEnabled && <span className="live-tag">{t('call.live')}</span>}
    </span>
  );
}

/** Everyone without a camera, big and centered: what a voice call looks like most of the time. */
export function VoiceRoom({ participants }: { participants: Participant[] }) {
  const n = participants.length;
  const size = n <= 2 ? 136 : n <= 4 ? 116 : n <= 8 ? 96 : n <= 15 ? 76 : 60;
  return (
    <div className="voice-room">
      <div className="voice-room-people" style={{ '--s': `${size}px` } as CSSProperties}>
        {participants.map((p) => (
          <div key={p.identity} className="person">
            <Avatar participant={p} />
            <PersonName participant={p} />
          </div>
        ))}
      </div>
    </div>
  );
}

/** Voice-only people while someone's camera or screen is on: a slim row under the video. */
export function VoiceStrip({ participants }: { participants: Participant[] }) {
  if (!participants.length) return null;
  return (
    <div className="voice-strip">
      {participants.map((p) => (
        <div key={p.identity} className="person-chip">
          <Avatar participant={p} size={30} />
          <PersonName participant={p} />
        </div>
      ))}
    </div>
  );
}
