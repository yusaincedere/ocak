import { AccessToken, RoomServiceClient, TrackSource } from 'livekit-server-sdk';
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
}

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

    async end(roomId) {
      try {
        await client.deleteRoom(livekitRoom(roomId));
      } catch (err) {
        if (!isNotFound(err)) throw err;
      }
    },
  };
}
