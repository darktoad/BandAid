import { describe, it, expect, vi } from 'vitest';
import { createLocalSessionStore } from './store';
import type { SessionState, SessionStore, Transport } from './types';

const transport = (over: Partial<Transport> = {}): Transport => ({
  songId: 's1',
  playing: true,
  startBar: 1,
  startTimestamp: 1000,
  tempo: 120,
  ...over,
});

describe('local session store', () => {
  it('starts empty', () => {
    const store = createLocalSessionStore();
    expect(store.getState()).toEqual({ currentSongId: null, transport: null, songSettings: {} });
  });

  it('sets the current song (the browsing → renderer seam)', () => {
    const store = createLocalSessionStore();
    store.setCurrentSong('big-john-mcneil');
    expect(store.getState().currentSongId).toBe('big-john-mcneil');
  });

  it('sets transport without disturbing currentSongId', () => {
    const store = createLocalSessionStore({ currentSongId: 'wabash' });
    store.setTransport(transport({ songId: 'wabash' }));
    const s = store.getState();
    expect(s.currentSongId).toBe('wabash');
    expect(s.transport?.tempo).toBe(120);
  });

  it('notifies subscribers on every change (Svelte store contract)', () => {
    const store = createLocalSessionStore();
    const seen: SessionState[] = [];
    const unsub = store.subscribe((s) => seen.push(structuredClone(s)));

    store.setCurrentSong('a');
    store.setTransport(transport({ songId: 'a', tempo: 90 }));
    unsub();
    store.setCurrentSong('b'); // ignored after unsubscribe

    // initial emit + 2 changes
    expect(seen.length).toBe(3);
    expect(seen[0]).toEqual({ currentSongId: null, transport: null, songSettings: {} });
    expect(seen[2].currentSongId).toBe('a');
    expect(seen[2].transport?.tempo).toBe(90);
  });

  describe('per-song settings (persisted, reversible overrides)', () => {
    it('an unset song reports no overrides', () => {
      const store = createLocalSessionStore();
      expect(store.getSongSettings('wabash')).toEqual({});
    });

    it('merges only defined fields and keeps the canonical default recoverable', () => {
      const store = createLocalSessionStore();
      store.setSongSetting('wabash', { tempoPct: 0.7 });
      expect(store.getSongSettings('wabash')).toEqual({ tempoPct: 0.7 });
      store.setSongSetting('wabash', { transpose: 2 });
      expect(store.getSongSettings('wabash')).toEqual({ tempoPct: 0.7, transpose: 2 });
    });

    it('resets one field back to default, leaving the others', () => {
      const store = createLocalSessionStore();
      store.setSongSetting('wabash', { tempoPct: 0.7, transpose: 2 });
      store.resetSongSetting('wabash', 'tempoPct');
      expect(store.getSongSettings('wabash')).toEqual({ transpose: 2 });
    });

    it('resetting the last field clears the song entry entirely (back to original)', () => {
      const store = createLocalSessionStore();
      store.setSongSetting('wabash', { tempoPct: 0.7 });
      store.resetSongSetting('wabash', 'tempoPct');
      expect(store.getSongSettings('wabash')).toEqual({});
      expect(store.getState().songSettings).toEqual({});
    });

    it('reset with no field clears every override for the song', () => {
      const store = createLocalSessionStore();
      store.setSongSetting('wabash', { tempoPct: 0.7, transpose: 2 });
      store.resetSongSetting('wabash');
      expect(store.getSongSettings('wabash')).toEqual({});
    });

    it('seeds from initial songSettings (the persistence/M2-shared entry point)', () => {
      const store = createLocalSessionStore({ songSettings: { wabash: { transpose: -1 } } });
      expect(store.getSongSettings('wabash')).toEqual({ transpose: -1 });
    });
  });

  /**
   * AC-5 — the M2-additive guarantee. A "fake remote writer" drives the store the
   * exact way M2's CRDT will (it only calls the SessionStore interface). A consumer
   * that subscribes through the interface reacts identically whether the write came
   * from local UI or a remote peer. Nothing here knows about networking.
   */
  it('a fake remote writer drives consumers the same as local writes (M2-ready)', () => {
    const store: SessionStore = createLocalSessionStore();

    // A consumer (e.g. the renderer) only knows the interface.
    const onState = vi.fn();
    store.subscribe(onState);
    onState.mockClear(); // drop the initial emit

    // Simulate a remote peer stamping new transport via the same interface.
    function fakeRemotePeer(s: SessionStore) {
      s.setCurrentSong('soldiers-joy');
      s.setTransport(transport({ songId: 'soldiers-joy', startBar: 17, tempo: 100 }));
    }
    fakeRemotePeer(store);

    expect(onState).toHaveBeenCalledTimes(2);
    const last = store.getState();
    expect(last.currentSongId).toBe('soldiers-joy');
    expect(last.transport?.startBar).toBe(17);
    expect(last.transport?.tempo).toBe(100);
  });
});
