/**
 * Ordering ranks for set lists and their entries: fixed-width base-36 integer
 * strings, so lexicographic order IS numeric order. Deliberately not true
 * fractional indexing — midpoints eventually exhaust a gap, and the caller then
 * rebalances the whole (small) list in one transaction instead of this module
 * carrying suffix-extension invariants. ~2.1e9 slots; a band's set list is dozens
 * of entries.
 */

const WIDTH = 6;
const BASE = 36;
const MAX = BASE ** WIDTH - 1;
/** Append stride: ~1M slots between plain appends (~2k appends before a rebalance). */
const STRIDE = 2 ** 20;

const toNum = (rank: string): number => parseInt(rank, BASE);
const toRank = (n: number): string => n.toString(BASE).padStart(WIDTH, '0');

/** The rank of the first item appended to an empty list. */
export const FIRST_RANK = toRank(STRIDE);

/** Evenly spread ranks for n items — deterministic (used for seeding AND rebalancing,
 *  so two devices materializing the same manifest list write identical values). */
export function seedRanks(count: number): string[] {
  const out: string[] = [];
  for (let i = 1; i <= count; i++) out.push(toRank(Math.floor((MAX / (count + 1)) * i)));
  return out;
}

/** A rank after `maxRank` (append), or null when out of room above (rebalance). */
export function rankAfter(maxRank: string | null): string | null {
  if (maxRank === null) return FIRST_RANK;
  const n = toNum(maxRank);
  if (n + STRIDE <= MAX) return toRank(n + STRIDE);
  return rankBetween(maxRank, null);
}

/** The midpoint strictly between two neighbours (null bound = list edge), or null
 *  when the gap is exhausted and the caller must rebalance. */
export function rankBetween(a: string | null, b: string | null): string | null {
  const lo = a === null ? 0 : toNum(a);
  const hi = b === null ? MAX : toNum(b);
  if (hi <= lo) return null;
  const mid = Math.floor((lo + hi) / 2);
  return mid > lo && mid < hi ? toRank(mid) : null;
}
