import * as Y from 'yjs';
import type {
  SessionState, SessionStore, SongSettings, Transport, TransportStampMeta,
  SharedTransportIntent, SharedSongIntent,
} from '../session/types';
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
  /**
   * Fires only for songSettings changes — deliberately separate from the generic
   * `subscribe`, which also fires for transport stamps (e.g. setTempoPercent's own
   * restamp). A consumer reacting to "did tempo/key change?" on the generic channel
   * would see a transport-only emit fire first and misread a not-yet-written value
   * as the real one.
   */
  subscribeSongSettings(run: (settings: Record<string, SongSettings>) => void): () => void;
  getSessionTransport(): SharedTransportIntent | null;
  getSessionSong(): SharedSongIntent | null;
  /** Fires on session.transport doc changes — own writes included (the follower's echo
   *  guard needs them to advance its issuedAt cursor). Dedicated channel: a songSettings
   *  or corrections change must never masquerade as a transport stamp, and vice versa. */
  subscribeSessionTransport(run: (t: SharedTransportIntent | null) => void): () => void;
  subscribeSessionSong(run: (s: SharedSongIntent | null) => void): () => void;
  /** The underlying doc, so providers (Task 5) can attach. */
  readonly doc: Y.Doc;
}

export function createSyncedSessionStore(
  opts: { doc?: Y.Doc; storage?: StorageLike | null; now?: () => number } = {},
): SyncedSessionStore {
  const ydoc = opts.doc ?? doc.createBandDoc();
  const storage = opts.storage === undefined ? safeLocalStorage() : opts.storage;
  const now = opts.now ?? (() => Date.now());
  // Runs before IndexeddbPersistence's async load lands; migrateSongSettings clears the
  // legacy key once applied, so there's nothing left to replay (and no clobber risk) on
  // any later reload.
  doc.migrateSongSettings(ydoc, storage ?? null);

  let identity = loadIdentity(storage ?? null);
  // currentSongId + transport are session-local in this spec (not yet doc-synced).
  let currentSongId: string | null = null;
  let transport: Transport | null = null;

  const stateSubs = new Set<(s: SessionState) => void>();
  const corrSubs = new Set<(list: Correction[]) => void>();
  const songSettingsSubs = new Set<(settings: Record<string, SongSettings>) => void>();
  const sessionTransportSubs = new Set<(t: SharedTransportIntent | null) => void>();
  const sessionSongSubs = new Set<(s: SharedSongIntent | null) => void>();

  const snapshot = (): SessionState => ({
    currentSongId,
    transport,
    songSettings: doc.listSongSettings(ydoc),
  });
  const emitState = () => stateSubs.forEach((cb) => cb(snapshot()));
  const emitCorrections = () => corrSubs.forEach((cb) => cb(doc.listCorrections(ydoc)));
  const emitSongSettings = () => songSettingsSubs.forEach((cb) => cb(doc.listSongSettings(ydoc)));
  const emitSessionTransport = () =>
    sessionTransportSubs.forEach((cb) => cb(doc.getSessionTransport(ydoc)));
  const emitSessionSong = () => sessionSongSubs.forEach((cb) => cb(doc.getSessionSong(ydoc)));

  ydoc.getMap('corrections').observeDeep(emitCorrections);
  // Without this, a remote peer's tempo/transpose change updates the doc but nothing
  // ever tells a subscriber to look — the tempo pill would silently go stale. This is
  // its own channel (not emitState) so a transport stamp can never masquerade as a
  // songSettings update — see the interface doc comment on subscribeSongSettings.
  ydoc.getMap('songSettings').observeDeep(emitSongSettings);

  // One observer, routed by key: transport stamps are high-rate relative to song
  // switches, and neither may masquerade as the other (same lesson as songSettings).
  ydoc.getMap('session').observe((event) => {
    if (event.keysChanged.has('transport')) emitSessionTransport();
    if (event.keysChanged.has('song')) {
      // Keep the generic snapshot's currentSongId coherent with the band's song.
      currentSongId = doc.getSessionSong(ydoc)?.songId ?? currentSongId;
      emitSessionSong();
    }
  });

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
      // Publish the switch: only the picker path calls this (App.svelte D6), so boot
      // resume / deep links / Back never yank the band. Observer fires for own writes
      // (the App's follower needs them to advance its issuedAt cursor).
      doc.setSessionSong(ydoc, {
        songId, issuedAt: now(), authorId: identity.authorId, author: identity.name,
      });
    },
    setTransport(t, meta: TransportStampMeta = { origin: 'anchor' }) {
      transport = t;
      emitState();
      // Only user intents sync; anchor/remote stamps are local projection state
      // (ADR-002 D2.1). The doc write is what reaches the band.
      if (meta.origin === 'intent') {
        doc.setSessionTransport(ydoc, {
          ...t, issuedAt: now(), authorId: identity.authorId, kind: meta.kind,
        });
      }
    },
    getSongSettings: (songId) => doc.getSongSettings(ydoc, songId),
    // No explicit emitState() here — the songSettings observer above fires for this
    // write the same way it would for a remote one, so local and remote stay identical.
    setSongSetting: (songId, patch: Partial<SongSettings>) => doc.setSongSetting(ydoc, songId, patch),
    resetSongSetting: (songId, field) => doc.resetSongSetting(ydoc, songId, field),
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
    subscribeSongSettings(run) {
      songSettingsSubs.add(run);
      run(doc.listSongSettings(ydoc));
      return () => songSettingsSubs.delete(run);
    },
    getSessionTransport: () => doc.getSessionTransport(ydoc),
    getSessionSong: () => doc.getSessionSong(ydoc),
    subscribeSessionTransport(run) {
      sessionTransportSubs.add(run);
      run(doc.getSessionTransport(ydoc));
      return () => sessionTransportSubs.delete(run);
    },
    subscribeSessionSong(run) {
      sessionSongSubs.add(run);
      run(doc.getSessionSong(ydoc));
      return () => sessionSongSubs.delete(run);
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
