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
