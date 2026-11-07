import { AccessToken, DataPacket_Kind, RoomServiceClient, TrackSource } from 'livekit-server-sdk';
import { config } from './config.js';
import type { AdminPerson } from './protocol.js';

/** Our room "limon3" is LiveKit room "room-limon3". */
export const livekitRoom = (roomId: string) => `room-${roomId}`;

/**
 * A call token for one connection. Admins get LiveKit's room-admin grant, which only they can see
 * (it is inside their own token); their identity looks like everyone else's.
 */
export async function callToken({ roomId, name, deviceId, admin }: { roomId: string; name: string; deviceId: string; admin: boolean }) {
  // Identity must be unique per connection: the same device may join from two tabs.
  const suffix = Math.random().toString(36).slice(2, 6);
  const at = new AccessToken(config.livekit.apiKey, config.livekit.apiSecret, {
    identity: `${deviceId}:${suffix}`,
    name,
    ttl: '12h',
  });
  at.addGrant({
    room: livekitRoom(roomId),
    roomJoin: true,
    canPublish: true,
    canSubscribe: true,
    canPublishData: true, // chat + remote control
    canUpdateOwnMetadata: true, // renaming yourself mid-call
    roomAdmin: admin,
  });
  return at.toJwt();
}

/** What the admin tools need from LiveKit. Tests swap in a fake. */
export interface CallControl {
  /** Everyone in every call, by our room id. Throws if LiveKit can't be reached. */
  people(): Promise<Map<string, AdminPerson[]>>;
  /** Turns off someone's microphone. False if they aren't in the call. */
  mute(roomId: string, identity: string): Promise<boolean>;
  /** Removes someone from the call. False if they aren't in it. */
  kick(roomId: string, identity: string): Promise<boolean>;
  /** Disconnects everyone in the call. */
  end(roomId: string): Promise<void>;
  /** Plays a door knock to this one person only (nobody else hears it). False if they aren't in the call. */
  knock(roomId: string, identity: string): Promise<boolean>;
  /** Sets (or with '' clears) the voice-effect attribute on someone. False if they aren't in the call. */
  setVoice(roomId: string, identity: string, value: string): Promise<boolean>;
}

/** Topic of the server's message that makes one person's app play a door knock (see web CallView). */
export const KNOCK_TOPIC = 'ocak.knock';

/** The participant attribute a person's app reads to change their own voice (see web presence.ts). */
export const VOICE_ATTRIBUTE = 'ocak.voice';

const isNotFound = (err: unknown) => (err as { status?: number })?.status === 404 || /not.?found/i.test(String(err));

export function livekitControl(): CallControl {
  const client = new RoomServiceClient(config.livekit.apiUrl, config.livekit.apiKey, config.livekit.apiSecret);

  const participants = async (roomId: string) => {
    try {
      return await client.listParticipants(livekitRoom(roomId));
    } catch (err) {
      if (isNotFound(err)) return [];
      throw err;
    }
  };

  return {
    async people() {
      const out = new Map<string, AdminPerson[]>();
      const rooms = (await client.listRooms()).filter((r) => r.name.startsWith('room-') && r.numParticipants > 0);
      await Promise.all(
        rooms.map(async (r) => {
          const roomId = r.name.slice('room-'.length);
          const list = await participants(roomId);
          out.set(
            roomId,
            list.map((p) => ({
              identity: p.identity,
              name: p.name || p.identity,
              joinedAt: Number(p.joinedAt) * 1000,
              micOn: p.tracks.some((t) => t.source === TrackSource.MICROPHONE && !t.muted),
            })),
          );
        }),
      );
      return out;
    },

    async mute(roomId, identity) {
      const person = (await participants(roomId)).find((p) => p.identity === identity);
      if (!person) return false;
      const mics = person.tracks.filter((t) => t.source === TrackSource.MICROPHONE && !t.muted);
      await Promise.all(mics.map((t) => client.mutePublishedTrack(livekitRoom(roomId), identity, t.sid, true)));
      return true;
    },

    async kick(roomId, identity) {
      try {
        await client.removeParticipant(livekitRoom(roomId), identity);
        return true;
      } catch (err) {
        if (isNotFound(err)) return false;
        throw err;
      }
    },

    async knock(roomId, identity) {
      if (!(await participants(roomId)).some((p) => p.identity === identity)) return false;
      await client.sendData(livekitRoom(roomId), new Uint8Array([1]), DataPacket_Kind.RELIABLE, {
        destinationIdentities: [identity],
        topic: KNOCK_TOPIC,
      });
      return true;
    },

    async setVoice(roomId, identity, value) {
      try {
        await client.updateParticipant(livekitRoom(roomId), identity, { attributes: { [VOICE_ATTRIBUTE]: value } });
        return true;
      } catch (err) {
        if (isNotFound(err)) return false;
        throw err;
      }
    },

    async end(roomId) {
      try {
        await client.deleteRoom(livekitRoom(roomId));
      } catch (err) {
        if (!isNotFound(err)) throw err;
      }
    },
  };
}
