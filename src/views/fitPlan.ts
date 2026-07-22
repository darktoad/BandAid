/**
 * Pure fit planning: pick the bars-per-row + scale that shows the whole tune in the
 * viewport. Deliberately deterministic (spec Part 2 #3): the inputs are the song, the
 * viewport, and a scale-NORMALIZED row height — the current scale/bars-per-row are not
 * inputs, so Fit converges to the same layout for a given song + viewport no matter
 * what the player dragged or fitted beforehand. The component measures the live render,
 * normalizes to 100% scale, plans here, then verifies/trims against the real render
 * (row heights shift slightly with density — the plan is an estimate, not a promise).
 */

// Legibility floor / zoom ceiling — the Size slider's own range. Below 75% the tune
// stays multi-page and the paged auto-turn covers it.
export const MIN_FIT_SCALE = 75;
export const MAX_FIT_SCALE = 225;

export interface FitContext {
  measureCount: number; // bars in the tune (> 0)
  viewH: number; // scroller clientHeight, px (> 0)
  rowH100: number; // height of one notation row at 100% scale, px (> 0)
  baseBarsPerRow: number; // responsive orphan-free pick for the stage width
}

export interface FitPlan {
  barsPerRow: number;
  scalePct: number;
}

// Down to the 5% grid (never overflow), inside the slider's bounds.
function quantize(rawPct: number): number {
  return Math.max(MIN_FIT_SCALE, Math.min(MAX_FIT_SCALE, Math.floor(rawPct / 5) * 5));
}

/**
 * Free-layout fit: try each row width from the responsive baseline up to 6 (the widest
 * the band's paper charts use) — wider rows mean fewer rows, letting a short tune trade
 * bar width for a single-page fit. Widths that orphan a lone final bar are skipped
 * (count % n === 1), matching pickBarsPerRow. Largest fitting scale wins; ties keep
 * the fewest bars per row (widest bars). Nothing fits even at the floor → the base
 * layout at MIN_FIT_SCALE.
 */
export function planFit(ctx: FitContext): FitPlan {
  const { measureCount, viewH, rowH100, baseBarsPerRow } = ctx;
  let best: FitPlan = { barsPerRow: baseBarsPerRow, scalePct: MIN_FIT_SCALE };
  for (let n = baseBarsPerRow; n <= 6; n++) {
    if (measureCount > n && measureCount % n === 1) continue; // no orphan rows
    const rows = Math.ceil(measureCount / n);
    const scalePct = quantize((viewH / (rows * rowH100)) * 100);
    if (scalePct > best.scalePct) best = { barsPerRow: n, scalePct };
  }
  return best;
}

/**
 * "As written" fit: the file's engraved breaks own the row structure, so scale is the
 * single lever. contentH100 is the full notation height at 100% scale.
 */
export function planWrittenFit(viewH: number, contentH100: number): number {
  return quantize((viewH / contentH100) * 100);
}
