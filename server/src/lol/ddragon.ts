// Data Dragon: Riot's public static data (champions, items, runes, summoner spells, icons).
// No API key needed. Loaded at startup and refreshed a few times a day to follow patches.
import { config } from '../config.js';

export type Locale = 'tr_TR' | 'en_US';
const LOCALES: Locale[] = ['en_US', 'tr_TR'];

export interface ChampionInfo {
  /** "MonkeyKing" (Data Dragon id, also the icon file name) */
  id: string;
  /** numeric key used in match data, e.g. 62 */
  key: number;
  name: Record<Locale, string>;
}

export interface ItemInfo {
  id: number;
  name: Record<Locale, string>;
  total: number;
  /** completed item you can't build further (legendaries, boots, starters) */
  final: boolean;
  boots: boolean;
  consumable: boolean;
  trinket: boolean;
  purchasable: boolean;
  onRift: boolean;
}

export interface RuneInfo {
  id: number;
  name: Record<Locale, string>;
  /** path under /cdn/img/ */
  icon: string;
  /** the rune tree (style) it belongs to; the tree itself has style === id */
  style: number;
}

export interface SpellInfo {
  key: number;
  id: string;
  name: Record<Locale, string>;
  image: string;
}

export interface StaticData {
  /** where it was loaded from (for on-demand files) */
  base: string;
  version: string;
  /** "15.21" — matches the start of a match's gameVersion */
  patch: string;
  champions: Map<number, ChampionInfo>;
  championsById: Map<string, ChampionInfo>;
  items: Map<number, ItemInfo>;
  runes: Map<number, RuneInfo>;
  spells: Map<number, SpellInfo>;
}

const patchOf = (version: string) => version.split('.').slice(0, 2).join('.');

/** Legendary-ish: a finished, purchasable item that isn't boots, a starter or a consumable. */
export const isCoreItem = (i: ItemInfo | undefined) =>
  !!i && i.final && !i.boots && !i.consumable && !i.trinket && i.purchasable && i.onRift && i.total >= 2000;
/** Tier 2 boots (Berserker's, Plated Steelcaps, …). */
export const isBoots = (i: ItemInfo | undefined) => !!i && i.boots && i.total >= 700 && i.onRift;

type Fetcher = (url: string) => Promise<unknown>;
const defaultFetch: Fetcher = async (url) => {
  const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`Data Dragon ${res.status} for ${url}`);
  return res.json();
};

interface RawItem {
  name: string;
  gold?: { total?: number; purchasable?: boolean };
  tags?: string[];
  into?: string[];
  maps?: Record<string, boolean>;
  consumed?: boolean;
  inStore?: boolean;
}
interface RawRuneStyle {
  id: number;
  name: string;
  icon: string;
  slots: { runes: { id: number; name: string; icon: string }[] }[];
}

export async function loadStaticData(fetcher: Fetcher = defaultFetch, base = config.lol.ddragonBase): Promise<StaticData> {
  const versions = (await fetcher(`${base}/api/versions.json`)) as string[];
  const version = versions[0]!;
  const cdn = `${base}/cdn/${version}/data`;

  const champions = new Map<number, ChampionInfo>();
  const items = new Map<number, ItemInfo>();
  const runes = new Map<number, RuneInfo>();
  const spells = new Map<number, SpellInfo>();

  for (const locale of LOCALES) {
    const [champJson, itemJson, runeJson, spellJson] = (await Promise.all([
      fetcher(`${cdn}/${locale}/champion.json`),
      fetcher(`${cdn}/${locale}/item.json`),
      fetcher(`${cdn}/${locale}/runesReforged.json`),
      fetcher(`${cdn}/${locale}/summoner.json`),
    ])) as [
      { data: Record<string, { id: string; key: string; name: string }> },
      { data: Record<string, RawItem> },
      RawRuneStyle[],
      { data: Record<string, { id: string; key: string; name: string; image: { full: string } }> },
    ];

    for (const c of Object.values(champJson.data)) {
      const key = Number(c.key);
      const entry = champions.get(key) ?? { id: c.id, key, name: { en_US: c.name, tr_TR: c.name } };
      entry.name[locale] = c.name;
      champions.set(key, entry);
    }
    for (const [idStr, it] of Object.entries(itemJson.data)) {
      const id = Number(idStr);
      const existing = items.get(id);
      if (existing) {
        existing.name[locale] = it.name;
        continue;
      }
      const tags = it.tags ?? [];
      items.set(id, {
        id,
        name: { en_US: it.name, tr_TR: it.name },
        total: it.gold?.total ?? 0,
        final: !it.into || it.into.length === 0,
        boots: tags.includes('Boots'),
        consumable: !!it.consumed || tags.includes('Consumable'),
        trinket: tags.includes('Trinket') || (tags.includes('Vision') && (it.gold?.total ?? 0) === 0),
        purchasable: it.gold?.purchasable !== false && it.inStore !== false,
        onRift: it.maps?.['11'] !== false,
      });
    }
    for (const style of runeJson) {
      const s = runes.get(style.id) ?? { id: style.id, name: { en_US: style.name, tr_TR: style.name }, icon: style.icon, style: style.id };
      s.name[locale] = style.name;
      runes.set(style.id, s);
      for (const slot of style.slots)
        for (const r of slot.runes) {
          const e = runes.get(r.id) ?? { id: r.id, name: { en_US: r.name, tr_TR: r.name }, icon: r.icon, style: style.id };
          e.name[locale] = r.name;
          runes.set(r.id, e);
        }
    }
    for (const sp of Object.values(spellJson.data)) {
      const key = Number(sp.key);
      const e = spells.get(key) ?? { key, id: sp.id, name: { en_US: sp.name, tr_TR: sp.name }, image: sp.image.full };
      e.name[locale] = sp.name;
      spells.set(key, e);
    }
  }

  return {
    base,
    version,
    patch: patchOf(version),
    champions,
    championsById: new Map([...champions.values()].map((c) => [c.id.toLowerCase(), c])),
    items,
    runes,
    spells,
  };
}

/** The data currently in use (null until the first successful load). */
let current: StaticData | null = null;
export const staticData = () => current;
export const setStaticData = (d: StaticData | null) => {
  current = d;
};

/** Load now and then every few hours; keeps the old data if a refresh fails. */
export function startStaticDataRefresh(log: (msg: string, err?: unknown) => void) {
  const refresh = async () => {
    try {
      const next = await loadStaticData();
      if (next.version !== current?.version) log(`Data Dragon ${next.version} loaded`);
      current = next;
    } catch (err) {
      log('Could not load Data Dragon', err);
    }
  };
  void refresh();
  return setInterval(refresh, 6 * 60 * 60 * 1000).unref();
}

// ---------- per-champion details (ability names and icons), loaded on demand ----------

export interface Ability {
  key: 'Q' | 'W' | 'E' | 'R';
  name: string;
  /** icon file under /cdn/<version>/img/spell/ */
  image: string;
}

const abilityCache = new Map<string, Promise<Ability[] | null>>();

/** Q/W/E/R names and icons for a champion (cached per version and language; null if unavailable). */
export function abilitiesOf(data: Pick<StaticData, 'base' | 'version'>, championId: string, locale: Locale, fetcher: Fetcher = defaultFetch) {
  const { base, version } = data;
  const key = `${version}/${locale}/${championId}`;
  let p = abilityCache.get(key);
  if (!p) {
    p = fetcher(`${base}/cdn/${version}/data/${locale}/champion/${championId}.json`)
      .then((json) => {
        const spells = (json as { data: Record<string, { spells?: { name: string; image: { full: string } }[] }> }).data[championId]?.spells;
        if (!spells || spells.length < 4) return null;
        return (['Q', 'W', 'E', 'R'] as const).map((k, i) => ({ key: k, name: spells[i]!.name, image: spells[i]!.image.full }));
      })
      .catch(() => {
        abilityCache.delete(key); // try again next time
        return null;
      });
    abilityCache.set(key, p);
    if (abilityCache.size > 600) abilityCache.delete(abilityCache.keys().next().value!);
  }
  return p;
}
