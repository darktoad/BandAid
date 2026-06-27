/**
 * The shared logical state of a BandAid session. In M1 this is a session of one
 * (writes are local); in M2 the same shape becomes a multi-writer CRDT. Only these
 * fields are ever synced — everything visual (zoom, scroll, instrument, audio
 * toggles) is local presentation and lives in components, never here.
 */

export interface Transport {
  songId: string;
  playing: boolean;
  /** Bar the playhead was at when these values were stamped (1-based, fractional ok). */
  startBar: number;
  /** Epoch milliseconds when these values were stamped. */
  startTimestamp: number;
  /** Quarter-notes per minute (the BPM the song plays at locally). */
  tempo: number;
}

export interface SessionState {
  currentSongId: string | null;
  transport: Transport | null;
}

/**
 * The swap boundary. M1 ships an in-memory local implementation; M2 replaces it
 * with a Yjs/CRDT-backed one behind this same interface, so no consumer changes.
 * `subscribe` follows the Svelte store contract so components can use `$store`.
 */
export interface SessionStore {
  subscribe(run: (state: SessionState) => void): () => void;
  getState(): SessionState;
  setCurrentSong(songId: string): void;
  setTransport(transport: Transport): void;
}
