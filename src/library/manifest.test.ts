import { describe, it, expect } from 'vitest';
import manifest from '../../public/library.json';
import type { LibraryManifest } from './types';

describe('bundled library manifest', () => {
  const m = manifest as LibraryManifest;

  it('every song carries a non-empty performance note', () => {
    for (const s of m.songs) {
      expect(typeof s.notes, `${s.id} notes`).toBe('string');
      expect((s.notes ?? '').length, `${s.id} notes`).toBeGreaterThan(0);
    }
  });

  it('only Wabash Cannonball advertises lyrics', () => {
    const withLyrics = m.songs.filter((s) => s.content.hasLyrics).map((s) => s.id);
    expect(withLyrics).toEqual(['wabash-cannonball']);
  });
});
