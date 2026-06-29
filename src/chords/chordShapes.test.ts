import { describe, it, expect } from 'vitest';
import { shapeFor } from './chordShapes';

describe('shapeFor', () => {
  it('returns a 6-string shape for a guitar chord', () => {
    const c = shapeFor('C', 'guitar');
    expect(c?.frets).toHaveLength(6);
  });

  it('returns a 4-string shape for a ukulele chord', () => {
    const c = shapeFor('C', 'ukulele');
    expect(c?.frets).toHaveLength(4);
  });

  it('covers every major chord in the current library on both instruments', () => {
    for (const label of ['C', 'F', 'G', 'A', 'D']) {
      expect(shapeFor(label, 'guitar'), `guitar ${label}`).not.toBeNull();
      expect(shapeFor(label, 'ukulele'), `ukulele ${label}`).not.toBeNull();
    }
  });

  it('returns null for an unknown chord (name-only fallback)', () => {
    expect(shapeFor('C#dim7', 'guitar')).toBeNull();
    expect(shapeFor('Zzz', 'ukulele')).toBeNull();
  });
});
