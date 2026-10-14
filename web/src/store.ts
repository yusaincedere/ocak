import { create } from 'zustand';
import type { ServerConfig } from '../../server/src/protocol';
import type { AvatarPick } from './avatar';
import type { DesktopSettings } from './desktop-bridge';
import {
  getAvatar,
  getLang,
  getName,
  getNoiseReduction,
  getVolumes,
  saveNoiseReduction,
  saveVolumes,
  setAvatar as saveAvatar,
  setLang as saveLang,
} from './identity';
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
  avatar: AvatarPick | null;
  /** Loaded from /api/config at startup. */
  serverConfig: ServerConfig | null;
  call: Call | null;
  deafened: boolean;
  notice: string | null;
  /** Only set inside the desktop app. */
  desktopSettings: DesktopSettings | null;
  /** Push-to-talk key is currently held. */
  pttActive: boolean;
  /** Per-friend volume (0..2), keyed by device id. */
  volumes: Record<string, number>;
  noiseReduction: boolean;

  setLang: (l: Lang) => void;
  setName: (n: string) => void;
  setAvatar: (a: AvatarPick | null) => void;
  setServerConfig: (c: ServerConfig) => void;
  setCall: (c: Call | null) => void;
  setDeafened: (d: boolean) => void;
  setNotice: (n: string | null) => void;
  setDesktopSettings: (s: DesktopSettings) => void;
  setPttActive: (v: boolean) => void;
  setVolume: (deviceId: string, volume: number) => void;
  setNoiseReduction: (on: boolean) => void;
}

export const useStore = create<State>((set) => ({
  lang: getLang(),
  name: getName(),
  avatar: getAvatar(),
  serverConfig: null,
  call: null,
  deafened: false,
  notice: null,
  desktopSettings: null,
  pttActive: false,
  volumes: getVolumes(),
  noiseReduction: getNoiseReduction(),

  setLang: (lang) => {
    saveLang(lang);
    document.documentElement.lang = lang;
    set({ lang });
  },
  setName: (name) => set({ name }),
  setAvatar: (avatar) => {
    saveAvatar(avatar);
    set({ avatar });
  },
  setServerConfig: (serverConfig) => set({ serverConfig }),
  setCall: (call) => set((s) => ({ call, deafened: call ? s.deafened : false, pttActive: false })),
  setDeafened: (deafened) => set({ deafened }),
  setNotice: (notice) => set({ notice }),
  setDesktopSettings: (desktopSettings) => set({ desktopSettings }),
  setPttActive: (pttActive) => set({ pttActive }),
  setVolume: (deviceId, volume) =>
    set((s) => {
      const volumes = { ...s.volumes };
      const v = Math.round(Math.min(2, Math.max(0, volume)) * 100) / 100;
      if (v === 1) delete volumes[deviceId];
      else volumes[deviceId] = v;
      saveVolumes(volumes);
      return { volumes };
    }),
  setNoiseReduction: (noiseReduction) => {
    saveNoiseReduction(noiseReduction);
    set({ noiseReduction });
  },
}));
