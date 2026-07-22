import { describe, expect, it } from 'vitest';
import {
  CHART_PAGE_WIDTH,
  MIN_LEGIBLE_PAGE_ZOOM,
  MIN_LEGIBLE_TEXT_ZOOM,
  pageFitZoom,
  pageScale,
  virtualPageWidth,
} from './pageScale';

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

  it('holds at the floor rather than crushing the page (phone), letting it scroll', () => {
    // The real phone case: whole-page would be 0.36 — ~4px staves. Hold the floor.
    expect(pageScale(375, 708, 375, 1966)).toBeLessThan(MIN_LEGIBLE_PAGE_ZOOM);
    expect(pageFitZoom(375, 708, 375, 1966)).toBeCloseTo(MIN_LEGIBLE_PAGE_ZOOM, 3);
  });

  it('never exceeds the width fit — no horizontal scrolling to read music', () => {
    // Page twice the view's width: width-fit 0.5 wins over the 0.55 floor.
    expect(pageFitZoom(500, 400, 1000, 4000)).toBe(0.5);
  });

  it('is CONTINUOUS across the floor — a 1px drag must not snap the size', () => {
    // The bug David hit: pane 475px→494px jumped zoom 1.00 → 0.566 (1.8x).
    // Sweep the boundary and assert no step bigger than the input change.
    const paneW = 500;
    let prev = pageFitZoom(paneW, 1000, paneW, 3000, MIN_LEGIBLE_TEXT_ZOOM);
    for (let contentH = 3000; contentH >= 1000; contentH -= 10) {
      const z = pageFitZoom(paneW, 1000, paneW, contentH, MIN_LEGIBLE_TEXT_ZOOM);
      expect(Math.abs(z - prev)).toBeLessThan(0.05); // smooth, no cliff
      prev = z;
    }
  });

  it('takes a custom floor — text refuses to shrink as far as notation', () => {
    // Same box: notation may go to 0.55, lyrics stop at 0.8 and scroll instead.
    expect(pageFitZoom(500, 500, 500, 1000)).toBeCloseTo(MIN_LEGIBLE_PAGE_ZOOM, 3);
    expect(pageFitZoom(500, 500, 500, 1000, MIN_LEGIBLE_TEXT_ZOOM)).toBeCloseTo(MIN_LEGIBLE_TEXT_ZOOM, 3);
  });

  it('never upscales', () => {
    expect(pageFitZoom(1000, 1000, 300, 200)).toBe(1);
  });

  it('is 1 on degenerate boxes', () => {
    expect(pageFitZoom(0, 0, 0, 0)).toBe(1);
  });
});
