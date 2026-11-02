import type { LolRole } from '../protocol.js';

// Bootstrap positions extracted from Riot client champion statistics, via CommunityDragon.
// Source: https://raw.communitydragon.org/latest/plugins/rcp-fe-lol-champion-statistics/global/default/rcp-fe-lol-champion-statistics.js
// Snapshot: 2026-11-03. Only numeric champion IDs/positions are stored; no upstream code is executed.
// Filtered against the current Data Dragon roster by the metadata route.
const BASELINE_LANES: Record<LolRole, readonly number[]> = {
  TOP: [2, 6, 10, 14, 17, 23, 24, 27, 31, 36, 39, 41, 48, 54, 58, 68, 74, 75, 79, 80, 82, 83, 84, 85, 86, 92, 98, 106, 114, 122, 126, 150, 157, 164, 223, 240, 266, 420, 516, 777, 799, 875, 887, 897, 904],
  JUNGLE: [5, 9, 11, 19, 20, 28, 30, 31, 32, 33, 35, 56, 59, 60, 62, 64, 72, 76, 77, 91, 102, 104, 107, 113, 120, 121, 131, 133, 141, 154, 200, 203, 233, 234, 238, 245, 246, 254, 421, 427, 517, 876, 950],
  MIDDLE: [1, 3, 4, 7, 8, 13, 34, 38, 39, 45, 55, 61, 69, 84, 90, 99, 101, 103, 105, 112, 127, 131, 134, 136, 142, 157, 163, 166, 238, 245, 246, 268, 517, 711, 777, 800, 805, 893, 910],
  BOTTOM: [15, 18, 21, 22, 29, 42, 51, 67, 81, 96, 110, 112, 115, 119, 145, 157, 202, 221, 222, 236, 360, 429, 498, 523, 804, 895, 901],
  UTILITY: [12, 16, 25, 26, 37, 40, 43, 44, 50, 53, 57, 63, 78, 80, 89, 99, 101, 111, 117, 143, 147, 161, 201, 223, 235, 267, 350, 412, 432, 497, 518, 526, 555, 888, 902],
};

/** Known positions work on a fresh database; locally observed positions can extend them. */
export function rouletteLanes(champion: number, observed: readonly LolRole[] = []): LolRole[] {
  const baseline = (Object.keys(BASELINE_LANES) as LolRole[]).filter((role) => BASELINE_LANES[role].includes(champion));
  return [...new Set([...baseline, ...observed])];
}
