import { describe, it, expect } from 'vitest';
import { projectBar, quarterNotesPerBar } from './projectBar';
import type { Transport } from '../session/types';

const base = (over: Partial<Transport> = {}): Transport => ({
  songId: 's1',
  playing: true,
  startBar: 1,
  startTimestamp: 0,
  tempo: 120,
  ...over,
});

describe('projectBar', () => {
  it('returns startBar exactly when paused, regardless of elapsed time', () => {
    const t = base({ playing: false, startBar: 9 });
    expect(projectBar(t, 999_999, 4)).toBe(9);
  });

  it('advances one bar per 2s at 120 qpm in 4/4', () => {
    // 120 quarter notes/min = 2 quarters/sec; 4 quarters/bar → 1 bar / 2000ms.
    const t = base({ startBar: 1, startTimestamp: 0, tempo: 120 });
    expect(projectBar(t, 2_000, 4)).toBeCloseTo(2, 10);
    expect(projectBar(t, 4_000, 4)).toBeCloseTo(3, 10);
    expect(projectBar(t, 1_000, 4)).toBeCloseTo(1.5, 10);
  });

  it('respects meter: 6/8 has 3 quarter-notes per bar', () => {
    const t = base({ startBar: 1, startTimestamp: 0, tempo: 120 });
    // 2 quarters/sec ÷ 3 quarters/bar → advances 1 bar every 1500ms.
    expect(projectBar(t, 1_500, quarterNotesPerBar('6/8'))).toBeCloseTo(2, 10);
  });

  it('never goes backwards before startTimestamp (clamps elapsed at 0)', () => {
    const t = base({ startBar: 5, startTimestamp: 10_000 });
    expect(projectBar(t, 9_000, 4)).toBe(5);
  });

  it('projects from a non-1 startBar (M2 seek-to-peer case)', () => {
    const t = base({ startBar: 17, startTimestamp: 1_000, tempo: 120 });
    expect(projectBar(t, 3_000, 4)).toBeCloseTo(18, 10); // +2000ms → +1 bar
  });

  it('throws on a non-positive quarterNotesPerBar', () => {
    expect(() => projectBar(base(), 0, 0)).toThrow();
  });
});

describe('quarterNotesPerBar', () => {
  it.each([
    ['4/4', 4],
    ['2/4', 2],
    ['6/8', 3],
    ['3/4', 3],
    ['2/2', 4],
  ])('%s → %d', (sig, expected) => {
    expect(quarterNotesPerBar(sig)).toBe(expected);
  });

  it('throws on garbage', () => {
    expect(() => quarterNotesPerBar('nope')).toThrow();
  });
});
