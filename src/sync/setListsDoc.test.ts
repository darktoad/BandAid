import { describe, it, expect } from 'vitest';
import { createBandDoc, exportUpdate, importUpdate } from './doc';
import {
  putSetListEntry, putSetListEntryRank, putSetListMeta, readSetLists,
  tombstoneSetList, tombstoneSetListEntry,
} from './setListsDoc';

describe('setLists doc accessors', () => {
  it('round-trips list meta, additions, rank overrides, and entry tombstones', () => {
    const doc = createBandDoc();
    putSetListMeta(doc, 'gig', { name: 'July Gig', rank: '000100' });
    putSetListEntry(doc, 'gig', 'e1', { songId: 'old-blue', rank: '000100' });
    putSetListEntry(doc, 'gig', 'e2', { songId: 'wabash-cannonball', variantId: 'sing-along', rank: '000200' });
    putSetListEntryRank(doc, 'gig', 'seed-0', '000300');
    tombstoneSetListEntry(doc, 'gig', 'seed-1');

    const gig = readSetLists(doc).get('gig')!;
    expect(gig.name).toBe('July Gig');
    expect(gig.rank).toBe('000100');
    expect(gig.deleted).toBe(false);
    expect(gig.added.get('e1')).toEqual({ songId: 'old-blue', rank: '000100' });
    expect(gig.added.get('e2')).toEqual({ songId: 'wabash-cannonball', variantId: 'sing-along', rank: '000200' });
    expect(gig.entryRanks.get('seed-0')).toBe('000300');
    expect(gig.gone.has('seed-1')).toBe(true);
  });

  it('tombstoning a list marks it deleted and clears its other keys', () => {
    const doc = createBandDoc();
    putSetListMeta(doc, 'gig', { name: 'Gig', rank: '000100' });
    putSetListEntry(doc, 'gig', 'e1', { songId: 'old-blue', rank: '000100' });
    tombstoneSetList(doc, 'gig');
    const gig = readSetLists(doc).get('gig')!;
    expect(gig.deleted).toBe(true);
    expect(gig.name).toBeUndefined();
    expect(gig.added.size).toBe(0);
  });

  it('a list tombstone survives a concurrent edit from a peer', () => {
    const a = createBandDoc();
    const b = createBandDoc();
    putSetListMeta(a, 'gig', { name: 'Gig', rank: '000100' });
    importUpdate(b, exportUpdate(a));

    tombstoneSetList(a, 'gig'); // device A deletes...
    putSetListEntry(b, 'gig', 'e9', { songId: 'old-blue', rank: '000100' }); // ...while B adds
    importUpdate(a, exportUpdate(b));
    importUpdate(b, exportUpdate(a));

    for (const doc of [a, b]) {
      expect(readSetLists(doc).get('gig')!.deleted).toBe(true);
    }
  });

  it('drops junk values from a buggy or hostile peer', () => {
    const doc = createBandDoc();
    const m = doc.getMap<unknown>('setLists');
    m.set('gig\u0000name', 42); // not a string
    m.set('gig\u0000entry\u0000e1', { songId: 7, rank: '000100' }); // bad songId
    m.set('gig\u0000entry\u0000e2', { songId: 'ok', rank: '000100', variantId: 5 }); // bad variantId
    m.set('gig\u0000entry\u0000e3', { songId: 'ok', rank: '000200' }); // good
    m.set('gig\u0000entryRank\u0000e3', 9); // not a string
    m.set('nonsense-key-without-separator', 'x');
    const gig = readSetLists(doc).get('gig')!;
    expect(gig.name).toBeUndefined();
    expect([...gig.added.keys()]).toEqual(['e3']);
    expect(gig.entryRanks.size).toBe(0);
  });
});
