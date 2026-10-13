// Remote-control messages, sent over the call's data channel (LiveKit) on one topic.
//
//   viewer  → sharer : request, input, ended
//   sharer  → viewer : granted, denied, ended
//
// The sharer's desktop app shows a native consent dialog and only injects input
// from the participant it approved, so these messages alone can't take control.
import type { LocalParticipant, Participant } from 'livekit-client';
import { CONTROL_TOPIC } from '../../server/src/protocol';
import type { ControlEndReason, ControlInput } from './desktop-bridge';

export { CONTROL_TOPIC };

/** Participant attribute a desktop sharer sets while their whole screen can be controlled. */
export const CONTROL_ATTRIBUTE = 'ocak.control';

export type ControlMessage =
  | { t: 'request' }
  | { t: 'granted'; until: number | null }
  | { t: 'denied'; reason?: string }
  | { t: 'ended'; reason?: ControlEndReason | 'cancelled' }
  | { t: 'input'; e: ControlInput };

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function sendControl(local: LocalParticipant, to: string, msg: ControlMessage) {
  // Mouse moves can be dropped (the next one replaces them); everything else must arrive.
  const reliable = !(msg.t === 'input' && msg.e.t === 'move');
  return local
    .publishData(encoder.encode(JSON.stringify(msg)), { reliable, destinationIdentities: [to], topic: CONTROL_TOPIC })
    .catch((err) => console.warn('control message not sent', err));
}

export function parseControl(payload: Uint8Array): ControlMessage | null {
  try {
    const m = JSON.parse(decoder.decode(payload)) as ControlMessage;
    return m && typeof m === 'object' && typeof m.t === 'string' ? m : null;
  } catch {
    return null;
  }
}

export const isControllable = (p: Participant) => p.attributes?.[CONTROL_ATTRIBUTE] === 'screen';
