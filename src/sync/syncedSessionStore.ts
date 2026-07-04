import * as Y from 'yjs';
import type { SessionState, SessionStore, SongSettings, Transport } from '../session/types';
import type { Correction, NewCorrection } from './types';
import type { Identity, StorageLike } from './identity';
import { loadIdentity, setDisplayName as persistName } from './identity';
import * as doc from './doc';
import { makeCorrection } from './corrections';

export interface SyncedSessionStore extends SessionStore {
  listCorrections(): Correction[];
  addCorrection(input: NewCorrection): Correction;
  setCorrectionStatus(id: string, status: Correction['status']): void;
  removeCorrection(id: string): void;
  getIdentity(): Identity;
  setDisplayName(name: string): void;
  subscribeCorrections(run: (list: Correction[]) => void): () => void;
  /** The underlying doc, so providers (Task 5) can attach. */
  readonly doc: Y.Doc;
}

export function createSyncedSessionStore(
  opts: { doc?: Y.Doc; storage?: StorageLike | null } = {},
): SyncedSessionStore {
  const ydoc = opts.doc ?? doc.createBandDoc();
  const storage = opts.storage === undefined ? safeLocalStorage() : opts.storage;
  // Runs before IndexeddbPersistence's async load lands — safe only because this is
  // idempotent (Yjs LWW-register semantics) and never mutates the legacy source.
  doc.migrateSongSettings(ydoc, storage ?? null);

  let identity = loadIdentity(storage ?? null);
  // currentSongId + transport are session-local in this spec (not yet doc-synced).
  let currentSongId: string | null = null;
  let transport: Transport | null = null;

  const stateSubs = new Set<(s: SessionState) => void>();
  const corrSubs = new Set<(list: Correction[]) => void>();

  const snapshot = (): SessionState => ({
    currentSongId,
    transport,
    songSettings: {}, // settings are read on demand via getSongSettings
  });
  const emitState = () => stateSubs.forEach((cb) => cb(snapshot()));
  const emitCorrections = () => corrSubs.forEach((cb) => cb(doc.listCorrections(ydoc)));

  ydoc.getMap('corrections').observeDeep(emitCorrections);

  return {
    doc: ydoc,
    subscribe(run) {
      stateSubs.add(run);
      run(snapshot());
      return () => stateSubs.delete(run);
    },
    getState: snapshot,
    setCurrentSong(songId) {
      currentSongId = songId;
      emitState();
    },
    setTransport(t) {
      transport = t;
      emitState();
    },
    getSongSettings: (songId) => doc.getSongSettings(ydoc, songId),
    setSongSetting: (songId, patch: Partial<SongSettings>) => {
      doc.setSongSetting(ydoc, songId, patch);
      emitState();
    },
    resetSongSetting: (songId, field) => {
      doc.resetSongSetting(ydoc, songId, field);
      emitState();
    },
    listCorrections: () => doc.listCorrections(ydoc),
    addCorrection(input) {
      const c = makeCorrection(input);
      doc.putCorrection(ydoc, c);
      return c;
    },
    setCorrectionStatus: (id, status) => doc.setCorrectionStatus(ydoc, id, status),
    removeCorrection: (id) => doc.removeCorrection(ydoc, id),
    getIdentity: () => identity,
    setDisplayName(name) {
      identity = persistName(name, storage ?? null);
    },
    subscribeCorrections(run) {
      corrSubs.add(run);
      run(doc.listCorrections(ydoc));
      return () => corrSubs.delete(run);
    },
  };
}

function safeLocalStorage(): StorageLike | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}
