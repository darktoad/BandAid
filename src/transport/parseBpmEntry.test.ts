import { describe, it, expect } from 'vitest';
import { parseBpmEntry } from './parseBpmEntry';

describe('parseBpmEntry', () => {
  const MIN = 63;
  const MAX = 200;

  it('accepts an in-range whole number', () => {
    expect(parseBpmEntry('120', MIN, MAX)).toBe(120);
  });

  it('accepts the exact bounds', () => {
    expect(parseBpmEntry('63', MIN, MAX)).toBe(63);
    expect(parseBpmEntry('200', MIN, MAX)).toBe(200);
  });

  it('rounds a fractional entry to a whole BPM', () => {
    expect(parseBpmEntry('119.4', MIN, MAX)).toBe(119);
    expect(parseBpmEntry('120.6', MIN, MAX)).toBe(121);
  });

  it('rejects a value above the ceiling instead of clamping to it', () => {
    // The reported bug: an appended digit committed on blur (tapping Count-in) snapped
    // the tempo to the 200 ceiling. It must now be a no-op, leaving the tempo untouched.
    expect(parseBpmEntry('12690', MIN, MAX)).toBeNull();
    expect(parseBpmEntry('201', MIN, MAX)).toBeNull();
  });

  it('rejects a value below the floor instead of clamping to it', () => {
    expect(parseBpmEntry('9', MIN, MAX)).toBeNull();
    expect(parseBpmEntry('0', MIN, MAX)).toBeNull();
  });

  it('rejects blank or whitespace-only entries', () => {
    expect(parseBpmEntry('', MIN, MAX)).toBeNull();
    expect(parseBpmEntry('   ', MIN, MAX)).toBeNull();
  });

  it('rejects non-numeric junk', () => {
    expect(parseBpmEntry('abc', MIN, MAX)).toBeNull();
    expect(parseBpmEntry('12x', MIN, MAX)).toBeNull();
  });

  it('tolerates surrounding whitespace on a valid entry', () => {
    expect(parseBpmEntry('  128  ', MIN, MAX)).toBe(128);
  });
});
