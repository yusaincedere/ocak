import { create } from 'zustand';
import type { DesktopSettings } from './desktop-bridge';
import { getLang, getName, setLang as saveLang } from './identity';
import type { Lang } from './i18n';

export interface Call {
  roomId: string;
  password: string;
  url: string;
  token: string;
}

interface State {
  lang: Lang;
  name: string | null;
  call: Call | null;
  deafened: boolean;
  notice: string | null;
  /** Only set inside the desktop app. */
  desktopSettings: DesktopSettings | null;
  /** Push-to-talk key is currently held. */
  pttActive: boolean;

  setLang: (l: Lang) => void;
  setName: (n: string) => void;
  setCall: (c: Call | null) => void;
  setDeafened: (d: boolean) => void;
  setNotice: (n: string | null) => void;
  setDesktopSettings: (s: DesktopSettings) => void;
  setPttActive: (v: boolean) => void;
}

export const useStore = create<State>((set) => ({
  lang: getLang(),
  name: getName(),
  call: null,
  deafened: false,
  notice: null,
  desktopSettings: null,
  pttActive: false,

  setLang: (lang) => {
    saveLang(lang);
    document.documentElement.lang = lang;
    set({ lang });
  },
  setName: (name) => set({ name }),
  setCall: (call) => set((s) => ({ call, deafened: call ? s.deafened : false, pttActive: false })),
  setDeafened: (deafened) => set({ deafened }),
  setNotice: (notice) => set({ notice }),
  setDesktopSettings: (desktopSettings) => set({ desktopSettings }),
  setPttActive: (pttActive) => set({ pttActive }),
}));
