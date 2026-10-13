// The API the Ocak desktop app (Electron) exposes to the web app as `window.ocakDesktop`.
// Types only: the desktop preload script imports this file to stay in sync.
// In a normal browser `window.ocakDesktop` is undefined and every desktop feature is skipped.

export interface ScreenSource {
  id: string;
  name: string;
  kind: 'screen' | 'window';
  /** PNG data URL */
  thumbnail: string;
  /** small app icon (windows only), PNG data URL */
  appIcon?: string;
}

/** One input event from the person controlling a shared screen. x/y are 0..1 within the shared screen. */
export type ControlInput =
  | { t: 'move'; x: number; y: number }
  | { t: 'button'; button: 'left' | 'right' | 'middle'; down: boolean; x: number; y: number }
  | { t: 'wheel'; dx: number; dy: number }
  | {
      t: 'key';
      /** KeyboardEvent.code (physical key) */
      code: string;
      /** KeyboardEvent.key (the character produced, for typing text) */
      key: string;
      down: boolean;
      shift: boolean;
      ctrl: boolean;
      alt: boolean;
      meta: boolean;
    };

export type ControlEndReason = 'stopped' | 'expired' | 'share-ended' | 'left';

/** A key or mouse button picked for push-to-talk. */
export interface HotkeyBinding {
  kind: 'key' | 'mouse';
  /** uiohook keycode or mouse button number */
  code: number;
  /** human-readable, e.g. "Caps Lock" or "Mouse 4" */
  label: string;
}

export interface DesktopSettings {
  serverUrl: string;
  pushToTalk: boolean;
  pttBinding: HotkeyBinding | null;
  /** Electron accelerator for toggling mute globally, e.g. "CommandOrControl+Shift+M" */
  muteShortcut: string;
  closeToTray: boolean;
  /** Show the small floating call overlay while Ocak is in the background. */
  overlay: boolean;
}

/** Snapshot of the call, sent to the desktop app for the overlay and tray menu. */
export interface CallSnapshot {
  roomId: string;
  muted: boolean;
  deafened: boolean;
  participants: { id: string; name: string; speaking: boolean; muted: boolean; isLocal: boolean; sharing: boolean }[];
}

export type CallAction = 'toggle-mute' | 'toggle-deafen' | 'leave';

export interface OcakDesktop {
  platform: 'win32' | 'darwin' | 'linux';
  version: string;
  /** System audio can be captured with a screen share (Windows only). */
  canShareSystemAudio: boolean;

  /** Main process asks the page to show the screen picker. Returns an unsubscribe fn. */
  onPickSource(cb: (sources: ScreenSource[]) => void): () => void;
  /** Answer the picker. `id: null` cancels. */
  pickSource(id: string | null, withAudio: boolean): void;

  /** Push-to-talk key went down (true) or up (false). */
  onPushToTalk(cb: (down: boolean) => void): () => void;
  /** Mute/deafen/leave from the global shortcut, tray menu or overlay. */
  onCallAction(cb: (action: CallAction) => void): () => void;
  /** Keep the overlay and tray up to date. `null` = not in a call. */
  setCallState(state: CallSnapshot | null): void;

  /** Switch to another Ocak server (validates the address, then loads it). */
  connect(serverUrl: string): Promise<{ ok: boolean; error?: string }>;

  getSettings(): Promise<DesktopSettings>;
  setSettings(patch: Partial<DesktopSettings>): Promise<DesktopSettings>;
  /** Wait for the next key or mouse button press anywhere and return it (for binding PTT). */
  captureHotkey(): Promise<HotkeyBinding | null>;

  /** Flash the taskbar / bounce the dock when something needs attention. */
  requestAttention(): void;

  // ---- remote control (this computer being controlled) ----

  /** What we're currently sharing: only a whole screen can be controlled. */
  getShareKind(): Promise<'screen' | 'window' | null>;
  /** Tell the app our screen share stopped (ends any control session). */
  shareStopped(): void;
  /** Show the native "X wants to control your screen" dialog. Starts the session if allowed. */
  confirmControl(controllerId: string, name: string): Promise<{ allow: boolean; until: number | null; error?: string }>;
  /** Forward one input event from the controller (ignored unless they were allowed). */
  injectInput(controllerId: string, input: ControlInput): void;
  /** End the current control session from the page. */
  stopControl(): void;
  /** The app ended the session (Stop button, shortcut, timeout...). */
  onControlEnded(cb: (reason: ControlEndReason) => void): () => void;
}

declare global {
  interface Window {
    ocakDesktop?: OcakDesktop;
  }
}

export const desktop: OcakDesktop | undefined = typeof window !== 'undefined' ? window.ocakDesktop : undefined;
