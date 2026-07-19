import { describe, expect, it } from 'vitest';
import { MAX_FIT_SCALE, MIN_FIT_SCALE, planFit, planWrittenFit } from './fitPlan';

// The planner is the deterministic core of Fit (spec Part 2 #3): its inputs are the
// song, the viewport, and a scale-normalized row height — never the CURRENT
// scale/bars-per-row — so the same song + viewport always yields the same layout.

describe('planFit', () => {
  it('trades wider rows for a larger scale when that fits more', () => {
    // 32 bars, rows of 4/5/6 → 8/7/6 rows. viewH 800 at rowH100 100:
    // n=4 → 100%, n=5 → 110%, n=6 → 130%. Widest rows win.
    const plan = planFit({ measureCount: 32, viewH: 800, rowH100: 100, baseBarsPerRow: 4 });
    expect(plan).toEqual({ barsPerRow: 6, scalePct: 130 });
  });

  it('skips row widths that orphan a lone final bar', () => {
    // 33 bars: 4/row leaves 1 orphan (33 % 4 === 1) so the responsive pick is 3;
    // candidates are 3 (11 rows), 5 (7 rows), 6 (6 rows) — 4 is skipped.
    const plan = planFit({ measureCount: 33, viewH: 600, rowH100: 100, baseBarsPerRow: 3 });
    expect(plan).toEqual({ barsPerRow: 6, scalePct: 100 });
  });

  it('quantizes to the 5% grid, rounding down (never overflow the view)', () => {
    // 8 bars at 4/row = 2 rows; viewH 430 → raw 215% → 215 exactly on grid;
    // viewH 428 → raw 214% → floor to 210.
    expect(planFit({ measureCount: 8, viewH: 430, rowH100: 100, baseBarsPerRow: 4 }).scalePct).toBe(215);
    expect(planFit({ measureCount: 8, viewH: 428, rowH100: 100, baseBarsPerRow: 4 }).scalePct).toBe(210);
  });

  it('clamps to the 225% ceiling and prefers fewer bars per row on ties', () => {
    // Huge viewport: every candidate hits 225 — keep the widest bars (base n).
    const plan = planFit({ measureCount: 8, viewH: 3000, rowH100: 100, baseBarsPerRow: 4 });
    expect(plan).toEqual({ barsPerRow: 4, scalePct: MAX_FIT_SCALE });
  });

  it('falls back to the base layout at the 75% floor when nothing fits', () => {
    // Tiny viewport: no candidate fits even at 75 — stay at the responsive base;
    // the paged auto-turn covers multi-page tunes below the legibility floor.
    const plan = planFit({ measureCount: 32, viewH: 100, rowH100: 100, baseBarsPerRow: 4 });
    expect(plan).toEqual({ barsPerRow: 4, scalePct: MIN_FIT_SCALE });
  });

  it('is independent of any current scale or layout (same inputs, same plan)', () => {
    const ctx = { measureCount: 16, viewH: 700, rowH100: 90, baseBarsPerRow: 4 };
    expect(planFit({ ...ctx })).toEqual(planFit({ ...ctx }));
  });
});

describe('planWrittenFit', () => {
  it('sizes the engraved layout to the view on the 5% grid', () => {
    expect(planWrittenFit(800, 1000)).toBe(80); // raw 80%
    expect(planWrittenFit(850, 1000)).toBe(85); // raw 85%
    expect(planWrittenFit(849, 1000)).toBe(80); // rounds down
  });

  it('clamps to the floor and ceiling', () => {
    expect(planWrittenFit(50, 1000)).toBe(MIN_FIT_SCALE);
    expect(planWrittenFit(9999, 100)).toBe(MAX_FIT_SCALE);
  });
});
