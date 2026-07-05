import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { createSyncedSessionStore } from './syncedSessionStore';
import { exportUpdate, importUpdate } from './doc';

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

  it('notifies subscribers with the new tempo when a remote peer changes it', () => {
    const docA = new Y.Doc();
    const docB = new Y.Doc();
    const a = createSyncedSessionStore({ doc: docA, storage: fakeStorage() });
    const b = createSyncedSessionStore({ doc: docB, storage: fakeStorage() });

    const seen: Array<number | undefined> = [];
    b.subscribeSongSettings((s) => seen.push(s['stones-rag']?.tempoPct));

    // Peer A sets tempo, then "syncs" to B the way a real provider would.
    a.setSongSetting('stones-rag', { tempoPct: 0.7 });
    importUpdate(docB, exportUpdate(docA));

    expect(seen.at(-1)).toBe(0.7);
    expect(b.getSongSettings('stones-rag')).toEqual({ tempoPct: 0.7 });
  });

  it('subscribeSongSettings does not fire on a plain transport stamp', () => {
    const store = createSyncedSessionStore({ storage: fakeStorage() });
    const seen: Array<Record<string, { tempoPct?: number }>> = [];
    store.subscribeSongSettings((s) => seen.push(s));
    seen.length = 0; // drop the initial emit

    store.setTransport({ songId: 's', playing: true, startBar: 1, startTimestamp: 1, tempo: 120 });
    expect(seen).toEqual([]); // transport-only change must not touch this channel

    store.setSongSetting('s', { tempoPct: 0.8 });
    expect(seen.at(-1)).toEqual({ s: { tempoPct: 0.8 } });
  });
});
