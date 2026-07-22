import { describe, expect, it } from 'vitest';
import { CHART_PAGE_WIDTH, MIN_LEGIBLE_PAGE_ZOOM, pageFitZoom, pageScale, virtualPageWidth } from './pageScale';

describe('pageScale', () => {
  it('shrinks by the tighter dimension', () => {
    expect(pageScale(1000, 500, 1000, 1000)).toBe(0.5); // height-bound
    expect(pageScale(500, 2000, 1000, 1000)).toBe(0.5); // width-bound
  });

  it('never scales UP — content smaller than the view stays at 1', () => {
    expect(pageScale(1000, 1000, 400, 300)).toBe(1);
  });

  it('is 1 on degenerate boxes (nothing measured yet)', () => {
    expect(pageScale(0, 500, 1000, 1000)).toBe(1);
    expect(pageScale(1000, 500, 0, 0)).toBe(1);
  });
});

describe('virtualPageWidth', () => {
  it('gives tablets and desktops the full chart width (4–6 bars per row)', () => {
    expect(virtualPageWidth(1024)).toBe(CHART_PAGE_WIDTH);
    expect(virtualPageWidth(1280)).toBe(CHART_PAGE_WIDTH);
  });

  it('narrows the page on a phone rather than shrinking past legibility', () => {
    const w = virtualPageWidth(375);
    expect(w).toBeLessThan(CHART_PAGE_WIDTH);
    // The page still fits the viewport at no worse than the legibility floor.
    expect(375 / w).toBeCloseTo(MIN_LEGIBLE_PAGE_ZOOM, 2);
  });

  it('never engraves narrower than the viewport (no pointless downscaling)', () => {
    expect(virtualPageWidth(1900)).toBeGreaterThanOrEqual(1900);
  });

  it('is 0 when nothing is measured yet', () => {
    expect(virtualPageWidth(0)).toBe(0);
  });
});

describe('pageFitZoom', () => {
  it('shows the whole page when that stays legible (tablet/desktop)', () => {
    // 1280x616 view, 1280x823 page → 0.75: comfortably readable, so fit it all.
    expect(pageFitZoom(1280, 616, 1280, 823)).toBeCloseTo(0.748, 2);
  });

  it('fits WIDTH instead of crushing the page below legibility (phone)', () => {
    // The real phone case: 375x708 view, 375x1966 page. Whole-page would be 0.36 —
    // ~4px staves. Fit the width (1) and let it scroll under the auto page-turn.
    const z = pageFitZoom(375, 708, 375, 1966);
    expect(z).toBe(1);
    expect(pageScale(375, 708, 375, 1966)).toBeLessThan(MIN_LEGIBLE_PAGE_ZOOM);
  });

  it('still shrinks a too-WIDE page to the width, even when illegibly tall', () => {
    // Width-bound fallback is a real shrink when the page is wider than the view.
    expect(pageFitZoom(500, 400, 1000, 4000)).toBe(0.5);
  });

  it('never upscales', () => {
    expect(pageFitZoom(1000, 1000, 300, 200)).toBe(1);
  });

  it('is 1 on degenerate boxes', () => {
    expect(pageFitZoom(0, 0, 0, 0)).toBe(1);
  });
});
