// Types shared by the server and the web app. Keep free of runtime imports.

export interface ServerConfig {
  /** Starting a call needs the server's create code. */
  createCodeRequired: boolean;
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
