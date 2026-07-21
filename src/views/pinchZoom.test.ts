import { describe, expect, it } from 'vitest';
import { clampZoom } from './pinchZoom';

describe('clampZoom', () => {
  it('passes through in-range zooms and clamps the extremes', () => {
    expect(clampZoom(1.2)).toBe(1.2);
    expect(clampZoom(0.05)).toBe(0.4);
    expect(clampZoom(9)).toBe(3);
  });
});
