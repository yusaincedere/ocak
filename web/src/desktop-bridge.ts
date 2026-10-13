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
}

declare global {
  interface Window {
    ocakDesktop?: OcakDesktop;
  }
}

export const desktop: OcakDesktop | undefined = typeof window !== 'undefined' ? window.ocakDesktop : undefined;
