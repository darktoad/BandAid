import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { createSyncedSessionStore } from './syncedSessionStore';
import { exportUpdate, importUpdate } from './doc';
import type { Transport } from '../session/types';

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

const t0: Transport = { songId: 'tune', playing: true, startBar: 1, startTimestamp: 60_000, tempo: 120 };

describe('session sync (playback)', () => {
  it('decorates intent stamps with issuedAt/authorId/kind and writes the doc', () => {
    const store = createSyncedSessionStore({ storage: fakeStorage(), now: () => 111 });
    store.setTransport(t0, { origin: 'intent', kind: 'play' });
    expect(store.getSessionTransport()).toEqual({
      ...t0, issuedAt: 111, authorId: store.getIdentity().authorId, kind: 'play',
    });
  });

  it('anchor and remote stamps never reach the doc', () => {
    const store = createSyncedSessionStore({ storage: fakeStorage() });
    store.setTransport(t0); // default = anchor
    store.setTransport(t0, { origin: 'anchor' });
    store.setTransport(t0, { origin: 'remote' });
    expect(store.getSessionTransport()).toBeNull();
    expect(store.getState().transport).toEqual(t0); // local projection state still updates
  });

  it('a remote peer’s intent arrives on the dedicated transport channel', () => {
    const a = createSyncedSessionStore({ storage: fakeStorage(), now: () => 5 });
    const b = createSyncedSessionStore({ storage: fakeStorage() });
    const seen: Array<ReturnType<typeof b.getSessionTransport>> = [];
    b.subscribeSessionTransport((s) => seen.push(s));
    a.setTransport(t0, { origin: 'intent', kind: 'play' });
    importUpdate(b.doc, exportUpdate(a.doc));
    expect(seen.at(-1)).toMatchObject({ ...t0, issuedAt: 5, kind: 'play' });
  });

  it('channel isolation: session writes don’t fire songSettings, and vice versa', () => {
    const store = createSyncedSessionStore({ storage: fakeStorage() });
    let settingsFires = 0;
    let transportFires = 0;
    store.subscribeSongSettings(() => settingsFires++);
    store.subscribeSessionTransport(() => transportFires++);
    const s0 = settingsFires; // both channels deliver once on subscribe
    const t0fires = transportFires;
    store.setTransport(t0, { origin: 'intent', kind: 'play' });
    expect(settingsFires).toBe(s0);
    store.setSongSetting('tune', { tempoPct: 0.8 });
    expect(transportFires).toBe(t0fires + 1); // only its own write moved it
  });

  it('setCurrentSong publishes a song intent with author info', () => {
    const store = createSyncedSessionStore({ storage: fakeStorage(), now: () => 42 });
    store.setDisplayName('Kate');
    store.setCurrentSong('soldiers-joy');
    expect(store.getSessionSong()).toEqual({
      songId: 'soldiers-joy', issuedAt: 42, authorId: store.getIdentity().authorId, author: 'Kate',
    });
  });
});
