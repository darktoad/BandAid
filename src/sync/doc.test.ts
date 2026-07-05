import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import {
  createBandDoc, listCorrections, putCorrection, setCorrectionStatus,
  getSongSettings, setSongSetting, resetSongSetting, listSongSettings,
  exportUpdate, importUpdate, migrateSongSettings,
} from './doc';
import { makeCorrection } from './corrections';
import {
  getSessionTransport, setSessionTransport, getSessionSong, setSessionSong,
} from './doc';
import type { SharedTransportIntent, SharedSongIntent } from '../session/types';

const c1 = makeCorrection(
  { songId: 's', anchor: { kind: 'point', bar: 1, beat: 1 }, text: 't', author: 'A', authorId: 'd', songVersion: 'v1' },
  { id: 'c1', now: 1 },
);

describe('doc corrections', () => {
  it('stores and reads a correction', () => {
    const doc = createBandDoc();
    putCorrection(doc, c1);
    expect(listCorrections(doc).map((c) => c.id)).toEqual(['c1']);
  });

  it('updates status in place', () => {
    const doc = createBandDoc();
    putCorrection(doc, c1);
    setCorrectionStatus(doc, 'c1', 'applied');
    expect(listCorrections(doc)[0].status).toBe('applied');
  });

  it('converges two docs that each add a correction (CRDT merge)', () => {
    const a = createBandDoc();
    const b = createBandDoc();
    putCorrection(a, { ...c1, id: 'a1' });
    putCorrection(b, { ...c1, id: 'b1' });
    // exchange updates both ways
    importUpdate(b, exportUpdate(a));
    importUpdate(a, exportUpdate(b));
    expect(listCorrections(a).map((c) => c.id).sort()).toEqual(['a1', 'b1']);
    expect(listCorrections(b).map((c) => c.id).sort()).toEqual(['a1', 'b1']);
  });
});

describe('doc songSettings', () => {
  it('merges and resets per-song settings', () => {
    const doc = createBandDoc();
    setSongSetting(doc, 's', { tempoPct: 0.8 });
    setSongSetting(doc, 's', { transpose: 2 });
    expect(getSongSettings(doc, 's')).toEqual({ tempoPct: 0.8, transpose: 2 });
    resetSongSetting(doc, 's', 'tempoPct');
    expect(getSongSettings(doc, 's')).toEqual({ transpose: 2 });
  });

  it('converges concurrent edits to different fields from two docs', () => {
    const a = createBandDoc();
    const b = createBandDoc();
    setSongSetting(a, 's', { tempoPct: 0.8 });
    setSongSetting(b, 's', { transpose: 2 });
    importUpdate(b, exportUpdate(a));
    importUpdate(a, exportUpdate(b));
    expect(getSongSettings(a, 's')).toEqual({ tempoPct: 0.8, transpose: 2 });
    expect(getSongSettings(b, 's')).toEqual({ tempoPct: 0.8, transpose: 2 });
  });

  it('lists every song\'s settings, grouped by songId', () => {
    const doc = createBandDoc();
    setSongSetting(doc, 'wabash', { tempoPct: 0.8 });
    setSongSetting(doc, 'stones-rag', { transpose: 2 });
    expect(listSongSettings(doc)).toEqual({
      wabash: { tempoPct: 0.8 },
      'stones-rag': { transpose: 2 },
    });
  });

  it('migrates legacy localStorage once, then clears the legacy key', () => {
    const m = new Map<string, string>([['bandaid.songSettings.v1', JSON.stringify({ s: { transpose: 3 } })]]);
    const storage = {
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => void m.set(k, v),
      removeItem: (k: string) => void m.delete(k),
    };
    const doc = createBandDoc();
    migrateSongSettings(doc, storage);
    expect(m.has('bandaid.songSettings.v1')).toBe(false);
    migrateSongSettings(doc, storage); // second call is a no-op (legacy key already gone)
    expect(getSongSettings(doc, 's')).toEqual({ transpose: 3 });
  });
});

const intent: SharedTransportIntent = {
  songId: 'tune', playing: true, startBar: 1, startTimestamp: 60_000, tempo: 120,
  issuedAt: 59_000, authorId: 'dev-a', kind: 'play',
};

describe('doc session map', () => {
  it('round-trips transport and song intents; empty doc reads null', () => {
    const doc = createBandDoc();
    expect(getSessionTransport(doc)).toBeNull();
    expect(getSessionSong(doc)).toBeNull();
    setSessionTransport(doc, intent);
    setSessionSong(doc, { songId: 'tune', issuedAt: 1, authorId: 'dev-a', author: 'Kate' });
    expect(getSessionTransport(doc)).toEqual(intent);
    expect(getSessionSong(doc)?.author).toBe('Kate');
  });

  it('converges: both docs agree on one stamp after exchanging updates', () => {
    const a = createBandDoc();
    const b = createBandDoc();
    setSessionTransport(a, intent);
    setSessionTransport(b, { ...intent, issuedAt: 59_500, authorId: 'dev-b', kind: 'pause', playing: false });
    importUpdate(b, exportUpdate(a));
    importUpdate(a, exportUpdate(b));
    // Yjs resolves the storage conflict (causality + client id); the app-level issuedAt
    // rule orders APPLICATION, not storage. Here we only assert convergence.
    expect(getSessionTransport(a)).toEqual(getSessionTransport(b));
  });
});
