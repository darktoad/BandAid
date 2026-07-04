import { describe, it, expect } from 'vitest';
import { readBandCode } from './bandCode';

function fakeStorage(seed: Record<string, string> = {}) {
  const m = new Map(Object.entries(seed));
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
}

describe('readBandCode', () => {
  it('reads ?band= and remembers it', () => {
    const s = fakeStorage();
    expect(readBandCode('?band=rhythm-cats', s)).toBe('rhythm-cats');
    expect(readBandCode('', s)).toBe('rhythm-cats'); // remembered
  });
  it('returns null when never set', () => {
    expect(readBandCode('', fakeStorage())).toBeNull();
  });
});
