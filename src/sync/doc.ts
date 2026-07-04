import * as Y from 'yjs';
import type { Correction } from './types';
import type { SongSettings } from '../session/types';
import type { StorageLike } from './identity';

const CORRECTIONS = 'corrections';
const SONG_SETTINGS = 'songSettings';
const META = 'meta';

export function createBandDoc(): Y.Doc {
  return new Y.Doc();
}

function correctionsMap(doc: Y.Doc): Y.Map<Correction> {
  return doc.getMap<Correction>(CORRECTIONS);
}
function songSettingsMap(doc: Y.Doc): Y.Map<SongSettings> {
  return doc.getMap<SongSettings>(SONG_SETTINGS);
}

export function listCorrections(doc: Y.Doc): Correction[] {
  return [...correctionsMap(doc).values()];
}
export function putCorrection(doc: Y.Doc, c: Correction): void {
  correctionsMap(doc).set(c.id, c);
}
export function setCorrectionStatus(doc: Y.Doc, id: string, status: Correction['status']): void {
  const m = correctionsMap(doc);
  const existing = m.get(id);
  if (existing) m.set(id, { ...existing, status });
}
export function removeCorrection(doc: Y.Doc, id: string): void {
  correctionsMap(doc).delete(id);
}

export function getSongSettings(doc: Y.Doc, songId: string): SongSettings {
  return { ...(songSettingsMap(doc).get(songId) ?? {}) };
}
export function setSongSetting(doc: Y.Doc, songId: string, patch: Partial<SongSettings>): void {
  const m = songSettingsMap(doc);
  const next: SongSettings = { ...(m.get(songId) ?? {}) };
  for (const [k, v] of Object.entries(patch)) {
    if (v !== undefined) (next as Record<string, unknown>)[k] = v;
  }
  m.set(songId, next);
}
export function resetSongSetting(doc: Y.Doc, songId: string, field?: keyof SongSettings): void {
  const m = songSettingsMap(doc);
  if (!field) {
    m.delete(songId);
    return;
  }
  const next = { ...(m.get(songId) ?? {}) };
  delete next[field];
  if (Object.keys(next).length === 0) m.delete(songId);
  else m.set(songId, next);
}

export function exportUpdate(doc: Y.Doc): Uint8Array {
  return Y.encodeStateAsUpdate(doc);
}
export function importUpdate(doc: Y.Doc, update: Uint8Array): void {
  Y.applyUpdate(doc, update);
}

/** Fold legacy localStorage song settings into the doc once. */
export function migrateSongSettings(doc: Y.Doc, storage?: StorageLike | null): void {
  const meta = doc.getMap<boolean>(META);
  if (meta.get('songSettingsMigrated')) return;
  try {
    const raw = storage?.getItem('bandaid.songSettings.v1');
    if (raw) {
      const legacy = JSON.parse(raw) as Record<string, SongSettings>;
      for (const [songId, settings] of Object.entries(legacy)) setSongSetting(doc, songId, settings);
    }
  } catch {
    /* ignore corrupt legacy value */
  }
  meta.set('songSettingsMigrated', true);
}
