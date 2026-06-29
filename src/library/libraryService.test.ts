import { describe, it, expect } from 'vitest';
import { makeLibraryService } from './libraryService';
import type { LibraryManifest, SongSummary } from './types';

const song = (id: string, over: Partial<SongSummary> = {}): SongSummary => ({
  id,
  title: id,
  defaultKey: { fifths: 0, mode: 'major', tonalCenter: 'C' },
  defaultTempoBpm: 120,
  timeSignature: '4/4',
  content: { hasMelody: true, hasChords: true, hasTab: true },
  parts: [{ instrument: 'Fiddle', notationType: 'notation' }],
  ...over,
});

const manifest: LibraryManifest = {
  songs: [song('a'), song('b'), song('c')],
  setLists: [
    { id: 'set1', name: 'Set One', entries: [{ songId: 'c' }, { songId: 'a' }] },
    // Includes a reference to a song that isn't in the library — must be skipped.
    { id: 'set2', name: 'Set Two', entries: [{ songId: 'b' }, { songId: 'ghost' }] },
  ],
};

describe('library service', () => {
  it('lists set lists and all songs from the manifest', () => {
    const svc = makeLibraryService(manifest);
    expect(svc.getSetLists().map((l) => l.id)).toEqual(['set1', 'set2']);
    expect(svc.getAllSongs().map((s) => s.id)).toEqual(['a', 'b', 'c']);
  });

  it('resolves a set list to its songs in manifest order', () => {
    const svc = makeLibraryService(manifest);
    expect(svc.getSetListSongs('set1').map((s) => s.id)).toEqual(['c', 'a']);
  });

  it('skips set-list entries that reference a missing song id (no crash)', () => {
    const svc = makeLibraryService(manifest);
    expect(svc.getSetListSongs('set2').map((s) => s.id)).toEqual(['b']);
  });

  it('returns null for an unknown song id', () => {
    const svc = makeLibraryService(manifest);
    expect(svc.getSongSummary('nope')).toBeNull();
    expect(svc.getSongSummary('a')?.id).toBe('a');
  });

  it('an empty / unknown set list resolves to no songs', () => {
    const svc = makeLibraryService(manifest);
    expect(svc.getSetListSongs('does-not-exist')).toEqual([]);
  });

  it('availableViews offers chord-changes only when hasChords (AC)', () => {
    const svc = makeLibraryService(manifest);
    const withChords = song('x');
    const noChords = song('y', { content: { hasMelody: true, hasChords: false, hasTab: false } });
    expect(svc.availableViews(withChords)).toContain('Chord changes');
    expect(svc.availableViews(noChords)).not.toContain('Chord changes');
    expect(svc.availableViews(noChords)).toEqual(['Melody']);
  });
});
