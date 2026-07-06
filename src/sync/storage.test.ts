import { describe, it, expect } from 'vitest';
import { readItem, writeItem } from './storage';

const throwing = {
  getItem: () => { throw new Error('denied'); },
  setItem: () => { throw new Error('quota'); },
  removeItem: () => { throw new Error('denied'); },
};

describe('storage helpers', () => {
  it('round-trips through a working storage', () => {
    const m = new Map<string, string>();
    const s = {
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => void m.set(k, v),
      removeItem: (k: string) => void m.delete(k),
    };
    writeItem(s, 'k', 'v');
    expect(readItem(s, 'k')).toBe('v');
    writeItem(s, 'k', null); // null removes
    expect(readItem(s, 'k')).toBeNull();
  });

  it('degrades to absent/no-op on null storage and on throwing storage', () => {
    expect(readItem(null, 'k')).toBeNull();
    expect(() => writeItem(null, 'k', 'v')).not.toThrow();
    expect(readItem(throwing, 'k')).toBeNull();
    expect(() => writeItem(throwing, 'k', 'v')).not.toThrow();
    expect(() => writeItem(throwing, 'k', null)).not.toThrow();
  });
});
