import { describe, it, expect } from 'vitest';
import type { SetList } from './types';
import type { DocSetList } from '../sync/setListsDoc';
import { mergeSetLists, seedEntries, seedEntryId } from './setListMerge';

const MANIFEST: SetList[] = [
  {
    id: 'rehearsal',
    name: 'Rehearsal Set',
    entries: [{ songId: 'stones-rag' }, { songId: 'wabash-cannonball', variantId: 'sing-along' }],
  },
  { id: 'gig', name: 'Gig', entries: [{ songId: 'old-blue' }] },
];

const docList = (partial: Partial<DocSetList>): DocSetList => ({
  deleted: false,
  added: new Map(),
  entryRanks: new Map(),
  gone: new Set(),
  ...partial,
});

describe('mergeSetLists', () => {
  it('with an empty doc, surfaces the manifest lists in order with seed identities', () => {
    const merged = mergeSetLists(MANIFEST, new Map());
    expect(merged.map((l) => ({ id: l.id, name: l.name }))).toEqual([
      { id: 'rehearsal', name: 'Rehearsal Set' },
      { id: 'gig', name: 'Gig' },
    ]);
    expect(merged[0].entries.map((e) => e.entryId)).toEqual([seedEntryId(0), seedEntryId(1)]);
    expect(merged[0].entries[1]).toMatchObject({ songId: 'wabash-cannonball', variantId: 'sing-along' });
  });

  it('layers doc deltas over the manifest: rename, addition, removal, move', () => {
    const seeds = seedEntries(MANIFEST[0]);
    const doc = new Map([
      ['rehearsal', docList({
        name: 'Rehearsal (edited)',
        added: new Map([['e1', { songId: 'old-blue', rank: '000001' }]]), // ranked before the seeds
        gone: new Set(['seed-0']),
        entryRanks: new Map([['seed-1', '000002']]), // moved between e1 and where seeds live
      })],
    ]);
    const rehearsal = mergeSetLists(MANIFEST, doc).find((l) => l.id === 'rehearsal')!;
    expect(rehearsal.name).toBe('Rehearsal (edited)');
    expect(rehearsal.entries.map((e) => e.songId)).toEqual(['old-blue', 'wabash-cannonball']);
    expect(rehearsal.entries[1].rank).not.toBe(seeds[1].rank); // override applied
  });

  it('a tombstoned list disappears, manifest or not', () => {
    const doc = new Map([
      ['rehearsal', docList({ deleted: true })],
      ['band-made', docList({ deleted: true, name: 'Zombie' })],
    ]);
    expect(mergeSetLists(MANIFEST, doc).map((l) => l.id)).toEqual(['gig']);
  });

  it('doc-born lists interleave with manifest lists by rank', () => {
    const doc = new Map([['band-made', docList({ name: 'Warmups', rank: '000001' })]]);
    expect(mergeSetLists(MANIFEST, doc).map((l) => l.id)).toEqual(['band-made', 'rehearsal', 'gig']);
  });

  it('entries sort by rank with entryId as the tie-break', () => {
    const doc = new Map([
      ['band-made', docList({
        name: 'Ties',
        added: new Map([
          ['zz', { songId: 'b-song', rank: '000100' }],
          ['aa', { songId: 'a-song', rank: '000100' }],
          ['mm', { songId: 'first', rank: '000050' }],
        ]),
      })],
    ]);
    const ties = mergeSetLists(MANIFEST, doc).find((l) => l.id === 'band-made')!;
    expect(ties.entries.map((e) => e.entryId)).toEqual(['mm', 'aa', 'zz']);
  });

  it('orphan doc keys (no name, no manifest counterpart) are ignored', () => {
    const doc = new Map([
      ['ghost', docList({ added: new Map([['e1', { songId: 'x', rank: '000100' }]]) })],
    ]);
    expect(mergeSetLists(MANIFEST, doc).map((l) => l.id)).toEqual(['rehearsal', 'gig']);
  });

  it('seedEntries is deterministic', () => {
    expect(seedEntries(MANIFEST[0])).toEqual(seedEntries(MANIFEST[0]));
  });
});
