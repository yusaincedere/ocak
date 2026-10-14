// Types shared by the server and the web app. Keep free of runtime imports.

export type Gender = 'male' | 'female';

export interface ServerConfig {
  /** Starting a call needs the server's create code. */
  createCodeRequired: boolean;
  /** Which kinds of random profile picture this server can hand out (empty: no pictures). */
  avatarGenders: Gender[];
}

/** A random profile picture. `src` is a same-origin path served by this server. */
export interface RandomAvatar {
  src: string;
  /** Size of the original image, when the picture API says so. */
  width: number | null;
  height: number | null;
}

export interface CreatedRoom {
  id: string;
  password: string;
}

export interface JoinResult {
  /** LiveKit URL to connect to */
  url: string;
  /** LiveKit access token */
  token: string;
  roomId: string;
}

/** Sent over the LiveKit data channel on this topic for remote-control (future). */
export const CONTROL_TOPIC = 'ocak-control';
