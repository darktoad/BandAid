import { describe, it, expect } from 'vitest';
import { FIRST_RANK, rankAfter, rankBetween, seedRanks } from './setListRank';

describe('setListRank', () => {
  it('ranks are fixed-width and lexicographic order matches numeric order', () => {
    const ranks = seedRanks(20);
    for (const r of ranks) expect(r).toMatch(/^[0-9a-z]{6}$/);
    const sorted = [...ranks].sort();
    expect(sorted).toEqual(ranks);
  });

  it('seedRanks are deterministic and evenly spread', () => {
    expect(seedRanks(3)).toEqual(seedRanks(3));
    const [a, b, c] = seedRanks(3);
    expect(a < b && b < c).toBe(true);
  });

  it('seedRanks(0) is empty', () => {
    expect(seedRanks(0)).toEqual([]);
  });

  it('rankAfter appends above the given rank', () => {
    const r1 = rankAfter(null);
    expect(r1).toBe(FIRST_RANK);
    const r2 = rankAfter(r1);
    expect(r2 && r2 > r1!).toBe(true);
  });

  it('rankAfter returns null when the ceiling is reached', () => {
    expect(rankAfter('zzzzzz')).toBeNull();
  });

  it('rankBetween finds a midpoint strictly between its neighbours', () => {
    const [a, , c] = seedRanks(3);
    const mid = rankBetween(a, c);
    expect(mid && mid > a && mid < c).toBe(true);
  });

  it('rankBetween(null, x) prepends below x; rankBetween(x, null) appends above x', () => {
    const [a] = seedRanks(1);
    const below = rankBetween(null, a);
    expect(below && below < a).toBe(true);
    const above = rankBetween(a, null);
    expect(above && above > a).toBe(true);
  });

  it('rankBetween returns null when the gap is exhausted (caller rebalances)', () => {
    expect(rankBetween('000001', '000002')).toBeNull();
    expect(rankBetween(null, '000001')).toBeNull(); // nothing below 1
  });

  it('repeated midpoint insertion eventually signals a rebalance instead of looping forever', () => {
    let lo = seedRanks(2)[0];
    const hi = seedRanks(2)[1];
    let steps = 0;
    for (;;) {
      const mid = rankBetween(lo, hi);
      if (mid === null) break;
      expect(mid > lo && mid < hi).toBe(true);
      lo = mid;
      steps++;
      expect(steps).toBeLessThan(64); // gap halves each time — must terminate fast
    }
    expect(steps).toBeGreaterThan(5);
  });
});
