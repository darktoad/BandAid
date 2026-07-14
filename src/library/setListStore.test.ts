import { describe, it, expect } from 'vitest';
import { createBandDoc, exportUpdate, importUpdate } from '../sync/doc';
import { createSetListStore } from './setListStore';
import type { SetList } from './types';

const MANIFEST: SetList[] = [
  {
    id: 'rehearsal',
    name: 'Rehearsal Set',
    entries: [{ songId: 'stones-rag' }, { songId: 'east-tennessee-blues' }, { songId: 'old-blue' }],
  },
];

const makeStore = () => {
  const doc = createBandDoc();
  return { doc, store: createSetListStore(doc, MANIFEST) };
};

/** Two-way sync, as providers would. */
const converge = (a: ReturnType<typeof createBandDoc>, b: ReturnType<typeof createBandDoc>) => {
  importUpdate(b, exportUpdate(a));
  importUpdate(a, exportUpdate(b));
  importUpdate(b, exportUpdate(a));
};

describe('setListStore', () => {
  it('starts from the manifest and appends on addSong', () => {
    const { store } = makeStore();
    store.addSong('rehearsal', 'wabash-cannonball', 'sing-along');
    const list = store.getLists()[0];
    expect(list.entries.map((e) => e.songId)).toEqual([
      'stones-rag', 'east-tennessee-blues', 'old-blue', 'wabash-cannonball',
    ]);
    expect(list.entries.at(-1)!.variantId).toBe('sing-along');
  });

  it('moveEntry reorders (front, middle, end)', () => {
    const { store } = makeStore();
    const ids = () => store.getLists()[0].entries.map((e) => e.songId);
    store.moveEntry('rehearsal', 'seed-2', 0); // old-blue to the front
    expect(ids()).toEqual(['old-blue', 'stones-rag', 'east-tennessee-blues']);
    store.moveEntry('rehearsal', 'seed-2', 2); // and to the end
    expect(ids()).toEqual(['stones-rag', 'east-tennessee-blues', 'old-blue']);
    store.moveEntry('rehearsal', 'seed-1', 1); // no-op move keeps order
    expect(ids()).toEqual(['stones-rag', 'east-tennessee-blues', 'old-blue']);
  });

  it('removeEntry on a manifest list keeps the other seeded entries', () => {
    const { store } = makeStore();
    store.removeEntry('rehearsal', 'seed-1');
    expect(store.getLists()[0].entries.map((e) => e.songId)).toEqual(['stones-rag', 'old-blue']);
  });

  it('create, rename, reorder, and delete set lists', () => {
    const { store } = makeStore();
    const id = store.createList('Warmups');
    expect(store.getLists().map((l) => l.name)).toEqual(['Rehearsal Set', 'Warmups']);
    store.renameList(id, 'Warm-ups');
    store.moveList(id, 0);
    expect(store.getLists().map((l) => l.name)).toEqual(['Warm-ups', 'Rehearsal Set']);
    store.deleteList('rehearsal'); // manifest lists can be deleted too
    expect(store.getLists().map((l) => l.name)).toEqual(['Warm-ups']);
  });

  it('subscribe fires immediately and on every edit', () => {
    const { store } = makeStore();
    const seen: number[] = [];
    const unsub = store.subscribe((lists) => seen.push(lists[0]?.entries.length ?? 0));
    store.addSong('rehearsal', 'wabash-cannonball');
    unsub();
    store.addSong('rehearsal', 'wabash-cannonball');
    expect(seen).toEqual([3, 4]); // initial + one edit; nothing after unsubscribe
  });

  it('many repeated front-moves stay ordered (rebalance path)', () => {
    const { store } = makeStore();
    // Alternate moving the last entry to index 1 — hammers the same gap until it
    // exhausts and forces a rebalance; order must stay coherent throughout.
    for (let i = 0; i < 40; i++) {
      const entries = store.getLists()[0].entries;
      store.moveEntry('rehearsal', entries.at(-1)!.entryId, 1);
      const after = store.getLists()[0].entries;
      expect(after).toHaveLength(entries.length);
      expect(after[1].entryId).toBe(entries.at(-1)!.entryId);
    }
  });

  it('concurrent first edits on two devices converge without duplicating seeds', () => {
    const a = makeStore();
    const b = makeStore();
    a.store.addSong('rehearsal', 'wabash-cannonball'); // both materialize independently
    b.store.removeEntry('rehearsal', 'seed-0');
    converge(a.doc, b.doc);
    for (const s of [a.store, b.store]) {
      const entries = s.getLists()[0].entries;
      // Both edits survive: seed-0 removed, wabash appended, seeds not duplicated.
      expect(entries.map((e) => e.songId)).toEqual(['east-tennessee-blues', 'old-blue', 'wabash-cannonball']);
    }
  });

  it('concurrent rename and reorder both survive (field-granular keys)', () => {
    const a = makeStore();
    const b = makeStore();
    a.store.renameList('rehearsal', 'Sunday Set');
    b.store.moveEntry('rehearsal', 'seed-2', 0);
    converge(a.doc, b.doc);
    for (const s of [a.store, b.store]) {
      const list = s.getLists()[0];
      expect(list.name).toBe('Sunday Set');
      expect(list.entries[0].songId).toBe('old-blue');
    }
  });

  it('a concurrent edit cannot resurrect a deleted list', () => {
    const a = makeStore();
    const b = makeStore();
    a.store.deleteList('rehearsal');
    b.store.addSong('rehearsal', 'wabash-cannonball');
    converge(a.doc, b.doc);
    expect(a.store.getLists()).toEqual([]);
    expect(b.store.getLists()).toEqual([]);
  });

  it('a fresh device syncing in sees edits, not a resurrected manifest default', () => {
    const a = makeStore();
    a.store.deleteList('rehearsal');
    const fresh = makeStore(); // never edited anything — doc is empty
    converge(a.doc, fresh.doc);
    expect(fresh.store.getLists()).toEqual([]); // tombstone wins over its bundled manifest
  });
});
