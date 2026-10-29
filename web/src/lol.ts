// League of Legends helpers on the web side: icons from Data Dragon and the server's LoL info.
import { useEffect } from 'react';
import { api } from './api';
import { useStore } from './store';

const DD = 'https://ddragon.leagueoflegends.com/cdn';

export const icon = {
  champion: (version: string, id: string) => `${DD}/${version}/img/champion/${id}.png`,
  item: (version: string, id: number) => `${DD}/${version}/img/item/${id}.png`,
  spell: (version: string, image: string) => `${DD}/${version}/img/spell/${image}`,
  rune: (path: string) => `${DD}/img/${path}`,
  /** wide splash art, cropped around the champion */
  splash: (id: string) => `${DD}/img/champion/centered/${id}_0.jpg`,
};

/** Loads /api/lol/meta once per language (enabled: false hides every LoL feature). */
export function useLolMeta() {
  const lang = useStore((s) => s.lang);
  const meta = useStore((s) => s.lolMeta);
  const rank = useStore((s) => s.lolRank);
  useEffect(() => {
    let cancelled = false;
    api
      .lolMeta(lang, rank)
      .then((m) => !cancelled && useStore.getState().setLolMeta(m))
      .catch(() => !cancelled && useStore.getState().setLolMeta({ enabled: false }));
    return () => {
      cancelled = true;
    };
  }, [lang, rank]);
  return meta;
}

/** Riot ID shapes we accept, same as the server ("Name#TAG"). */
export const RIOT_ID = /^.{3,16}#[^\s#]{2,5}$/u;

export const sameRiotId = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
