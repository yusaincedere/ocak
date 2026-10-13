import { create } from 'zustand';
import type { DesktopSettings } from './desktop-bridge';
import { getName } from './identity';

export interface Call {
  roomId: string;
  password: string;
  url: string;
  token: string;
}

interface State {
  name: string | null;
  call: Call | null;
  deafened: boolean;
  notice: string | null;
  /** Only set inside the desktop app. */
  desktopSettings: DesktopSettings | null;
  /** Push-to-talk key is currently held. */
  pttActive: boolean;

  setName: (n: string) => void;
  setCall: (c: Call | null) => void;
  setDeafened: (d: boolean) => void;
  setNotice: (n: string | null) => void;
  setDesktopSettings: (s: DesktopSettings) => void;
  setPttActive: (v: boolean) => void;
}

export const useStore = create<State>((set) => ({
  name: getName(),
  call: null,
  deafened: false,
  notice: null,
  desktopSettings: null,
  pttActive: false,

  setName: (name) => set({ name }),
  setCall: (call) => set((s) => ({ call, deafened: call ? s.deafened : false, pttActive: false })),
  setDeafened: (deafened) => set({ deafened }),
  setNotice: (notice) => set({ notice }),
  setDesktopSettings: (desktopSettings) => set({ desktopSettings }),
  setPttActive: (pttActive) => set({ pttActive }),
}));
