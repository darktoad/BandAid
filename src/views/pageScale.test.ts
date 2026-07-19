import { describe, expect, it } from 'vitest';
import { pageScale } from './pageScale';

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
