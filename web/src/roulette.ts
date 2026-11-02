import type { LolMeta, LolRole } from '../../server/src/protocol';

export type RouletteChampion = NonNullable<LolMeta['champions']>[number];
export const ROULETTE_LANES: LolRole[] = ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY'];

export function roulettePool(champions: RouletteChampion[], lane: LolRole | '') {
  // Defend against duplicate entries: every eligible champion has one equal chance.
  return [...new Map(champions.filter((c) => !lane || c.roles?.includes(lane)).map((c) => [c.id, c])).values()];
}

/** Uniform index without modulo bias. The visual reel never determines the outcome. */
export function randomIndex(size: number, draw = () => crypto.getRandomValues(new Uint32Array(1))[0]!) {
  if (!Number.isInteger(size) || size < 1 || size > 0x100000000) throw new RangeError('Invalid pool size');
  const limit = Math.floor(0x100000000 / size) * size;
  let value: number;
  do { value = draw(); } while (value >= limit);
  return value % size;
}

export function rouletteSpin(pool: RouletteChampion[], index = randomIndex) {
  if (!pool.length) return null;
  const winner = pool[index(pool.length)]!;
  const stop = 36;
  const reel = Array.from({ length: stop + 4 }, () => pool[index(pool.length)]!);
  reel[stop] = winner;
  return { winner, reel, stop };
}
