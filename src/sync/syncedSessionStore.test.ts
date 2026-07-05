import { describe, it, expect } from 'vitest';
import { createSyncedSessionStore } from './syncedSessionStore';

function fakeStorage() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  };
}

describe('createSyncedSessionStore', () => {
  it('satisfies the SessionStore surface (currentSong + transport)', () => {
    const store = createSyncedSessionStore({ storage: fakeStorage() });
    store.setCurrentSong('stones-rag');
    expect(store.getState().currentSongId).toBe('stones-rag');
  });

  it('adds a correction and notifies subscribers', () => {
    const store = createSyncedSessionStore({ storage: fakeStorage() });
    const seen: number[] = [];
    store.subscribeCorrections((list) => seen.push(list.length));
    const c = store.addCorrection({
      songId: 's', anchor: { kind: 'point', bar: 1, beat: 1 }, text: 't',
      author: 'A', authorId: store.getIdentity().authorId, songVersion: 'v1',
    });
    expect(store.listCorrections().map((x) => x.id)).toEqual([c.id]);
    expect(seen.at(-1)).toBe(1);
  });

  it('edits the display name via identity', () => {
    const store = createSyncedSessionStore({ storage: fakeStorage() });
    store.setDisplayName('Fiddle');
    expect(store.getIdentity().name).toBe('Fiddle');
  });
});
