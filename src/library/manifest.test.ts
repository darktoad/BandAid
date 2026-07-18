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

  it('variant ids are well-formed and unique per song', () => {
    for (const s of m.songs) {
      const ids = (s.variants ?? []).map((v) => v.id);
      for (const id of ids) expect(id, `${s.id} variant id`).toMatch(/^[a-z0-9-]+$/);
      expect(new Set(ids).size, `${s.id} variant ids unique`).toBe(ids.length);
    }
  });

  it('rehearsal set matches the gig running order', () => {
    const rehearsal = m.setLists.find((l) => l.id === 'rehearsal-set');
    expect(rehearsal).toBeDefined();
    expect(rehearsal!.entries.map((e) => e.songId)).toEqual([
      'east-tennessee-blues',
      'stones-rag',
      'old-blue',
      'wabash-cannonball',
    ]);
  });

  it('set-list variant references resolve to declared variants', () => {
    const byId = new Map(m.songs.map((s) => [s.id, s]));
    for (const list of m.setLists) {
      for (const e of list.entries) {
        if (!e.variantId) continue;
        const song = byId.get(e.songId);
        expect(song, `${list.id}: ${e.songId}`).toBeDefined();
        expect(
          song!.variants?.some((v) => v.id === e.variantId),
          `${list.id}: ${e.songId}@${e.variantId}`,
        ).toBe(true);
      }
    }
  });
});
