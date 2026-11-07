import { create } from 'zustand';
import type { LolMeta, LolTier, ServerConfig } from '../../server/src/protocol';
import type { AvatarPick } from './avatar';
import type { DesktopSettings } from './desktop-bridge';
import { pushRecentEmoji } from './emoji';
import {
  getAdminKey,
  setAdminKey as saveAdminKey,
  getAvatar,
  getChatSound,
  getCallSound,
  getRecentEmoji,
  getLang,
  getName,
  getNoiseReduction,
  getLolRank,
  getRiotAccount,
  getVolumes,
  saveChatSound,
  saveCallSound,
  saveRecentEmoji,
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
  /** null when an admin joined without the password */
  password: string | null;
  /** our call token has admin powers (never shown to others) */
  admin: boolean;
  url: string;
  token: string;
}

interface State {
  lang: Lang;
  name: string | null;
  avatar: AvatarPick | null;
  /** This device has the server's admin key. */
  isAdmin: boolean;
  /** Loaded from /api/config at startup. */
  serverConfig: ServerConfig | null;
  call: Call | null;
  chatDraft: string;
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
  /** joins, leaves, and connection changes */
  callSound: boolean;
  /** the picker's first row, kept on this device */
  recentEmoji: string[];
  riot: RiotAccount | null;
  /** /api/lol/meta, once loaded (enabled: false when the server has no Riot key) */
  lolMeta: LolMeta | null;
  /** LoL stats from this rank and above */
  lolRank: LolTier;

  setLang: (l: Lang) => void;
  setName: (n: string) => void;
  setAvatar: (a: AvatarPick | null) => void;
  setAdminKey: (key: string | null) => void;
  setServerConfig: (c: ServerConfig) => void;
  setCall: (c: Call | null) => void;
  setChatDraft: (draft: string) => void;
  setDeafened: (d: boolean) => void;
  setNotice: (n: string | null) => void;
  setDesktopSettings: (s: DesktopSettings) => void;
  setPttActive: (v: boolean) => void;
  setVolume: (deviceId: string, volume: number) => void;
  setNoiseReduction: (on: boolean) => void;
  setChatSound: (on: boolean) => void;
  setCallSound: (on: boolean) => void;
  addRecentEmoji: (emoji: string) => void;
  setRiot: (a: RiotAccount | null) => void;
  setLolMeta: (m: LolMeta | null) => void;
  setLolRank: (r: LolTier) => void;
}

export const useStore = create<State>((set) => ({
  lang: getLang(),
  name: getName(),
  avatar: getAvatar(),
  isAdmin: !!getAdminKey(),
  serverConfig: null,
  call: null,
  chatDraft: '',
  deafened: false,
  notice: null,
  desktopSettings: null,
  pttActive: false,
  volumes: getVolumes(),
  noiseReduction: getNoiseReduction(),
  chatSound: getChatSound(),
  callSound: getCallSound(),
  recentEmoji: getRecentEmoji(),
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
  setAdminKey: (key) => {
    saveAdminKey(key);
    set({ isAdmin: !!key });
  },
  setServerConfig: (serverConfig) => set({ serverConfig }),
  setCall: (call) => set((s) => ({ call, chatDraft: call ? s.chatDraft : '', deafened: call ? s.deafened : false, pttActive: false })),
  setChatDraft: (chatDraft) => set({ chatDraft }),
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
  setCallSound: (callSound) => {
    saveCallSound(callSound);
    set({ callSound });
    if (callSound) sounds.join(); // a sample
  },
  addRecentEmoji: (emoji) =>
    set((s) => {
      const recentEmoji = pushRecentEmoji(s.recentEmoji, emoji);
      saveRecentEmoji(recentEmoji);
      return { recentEmoji };
    }),
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
