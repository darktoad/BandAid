import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import {
  createBandDoc, listCorrections, putCorrection, setCorrectionStatus,
  getSongSettings, setSongSetting, resetSongSetting, exportUpdate, importUpdate, migrateSongSettings,
} from './doc';
import { makeCorrection } from './corrections';

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

  it('migrates legacy localStorage once', () => {
    const m = new Map<string, string>([['bandaid.songSettings.v1', JSON.stringify({ s: { transpose: 3 } })]]);
    const storage = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
    const doc = createBandDoc();
    migrateSongSettings(doc, storage);
    migrateSongSettings(doc, storage); // second call is a no-op
    expect(getSongSettings(doc, 's')).toEqual({ transpose: 3 });
  });
});
