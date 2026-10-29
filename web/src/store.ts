import { create } from 'zustand';
import type { LolMeta, LolTier, ServerConfig } from '../../server/src/protocol';
import type { AvatarPick } from './avatar';
import type { DesktopSettings } from './desktop-bridge';
import {
  getAvatar,
  getChatSound,
  getLang,
  getName,
  getNoiseReduction,
  getLolRank,
  getRiotAccount,
  getVolumes,
  saveChatSound,
  saveNoiseReduction,
  saveLolRank,
  saveRiotAccount,
  type RiotAccount,
  saveVolumes,
  setAvatar as saveAvatar,
  setLang as saveLang,
} from './identity';
import type { Lang } from './i18n';
import { sounds } from './sounds';

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
  /** a sound for new chat messages */
  chatSound: boolean;
  riot: RiotAccount | null;
  /** /api/lol/meta, once loaded (enabled: false when the server has no Riot key) */
  lolMeta: LolMeta | null;
  /** LoL stats from this rank and above */
  lolRank: LolTier;

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
  setChatSound: (on: boolean) => void;
  setRiot: (a: RiotAccount | null) => void;
  setLolMeta: (m: LolMeta | null) => void;
  setLolRank: (r: LolTier) => void;
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
  chatSound: getChatSound(),
  riot: getRiotAccount(),
  lolMeta: null,
  lolRank: getLolRank(),

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
  setChatSound: (chatSound) => {
    saveChatSound(chatSound);
    set({ chatSound });
    if (chatSound) sounds.message(); // a sample
  },
  setRiot: (riot) => {
    saveRiotAccount(riot);
    set({ riot });
  },
  setLolMeta: (lolMeta) => set({ lolMeta }),
  setLolRank: (lolRank) => {
    saveLolRank(lolRank);
    set({ lolRank });
  },
}));
