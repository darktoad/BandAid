/**
 * The largest uniform scale (≤ 1) that fits a content box inside a view box — the
 * "photo of the sheet" shrink shared by page-mode Fit (notation) and the lyrics
 * pane. Never upscales: content that already fits renders at natural size.
 * Degenerate boxes (nothing measured yet) → 1, i.e. no transform.
 */
export function pageScale(viewW: number, viewH: number, contentW: number, contentH: number): number {
  if (viewW <= 0 || viewH <= 0 || contentW <= 0 || contentH <= 0) return 1;
  return Math.min(1, viewW / contentW, viewH / contentH);
}

/**
 * The legibility floor for whole-page fitting. Below this the staves turn to
 * hairlines: a full tune on a phone works out to ~0.36 — roughly 4px noteheads,
 * which nobody can read from a music stand.
 */
export const MIN_LEGIBLE_PAGE_ZOOM = 0.55;

/**
 * Page-mode Fit with a legibility guard. "Whole page in view" is the goal, but only
 * while the result is still readable — on a tall, narrow screen (a phone) fitting a
 * whole tune vertically crushes it AND wastes most of the width. When the whole-page
 * scale would fall under the floor we fit the WIDTH instead, which keeps the music at
 * a readable size and lets the page scroll; the paged auto-turn already carries the
 * player through it. This is a physics limit, not a tuning problem: 16 bars of
 * notation cannot be legible on a 4-inch screen at any scale.
 */
/**
 * The widest page we'd ever engrave: about what a printed chart needs to hold 4–6 bars
 * in a row. Beyond this, rows get longer than any paper chart and the eye loses the
 * phrase structure.
 */
export const CHART_PAGE_WIDTH = 1600;

/**
 * The virtual page width for a viewport: as wide as possible — so a row holds a chart's
 * worth of bars — WITHOUT shrinking the page past legibility once it's scaled to fit.
 * A tablet gets the full chart width (4–6 bars per row); a portrait phone gets a
 * narrower page (fewer bars per row) instead of unreadable music, because 4–6 bars
 * across four inches is physically too small to read.
 */
export function virtualPageWidth(viewW: number): number {
  if (viewW <= 0) return 0;
  return Math.round(Math.max(viewW, Math.min(CHART_PAGE_WIDTH, viewW / MIN_LEGIBLE_PAGE_ZOOM)));
}

export function pageFitZoom(viewW: number, viewH: number, contentW: number, contentH: number): number {
  const whole = pageScale(viewW, viewH, contentW, contentH);
  if (whole >= MIN_LEGIBLE_PAGE_ZOOM) return whole;
  if (viewW <= 0 || contentW <= 0) return 1;
  return Math.min(1, viewW / contentW);
}
