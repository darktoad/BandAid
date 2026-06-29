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

/**
 * Per-song performance overrides on top of the song's canonical defaults. Every field
 * is OPTIONAL: absent means "use the original" — so the canonical file is never edited
 * and "reset to original" is just clearing the field. These are shared logical state
 * (tempo/key are session-shared per the roadmap), persisted across reloads, and become
 * multi-writer in M2 with no shape change.
 */
export interface SongSettings {
  /** Tempo as a fraction of the song default (0.7 = 70%); absent = song default. */
  tempoPct?: number;
  /** Semitones from the written key; absent or 0 = original key. */
  transpose?: number;
}

export interface SessionState {
  currentSongId: string | null;
  transport: Transport | null;
  /** Per-song overrides, keyed by song id. Persisted; reversible by clearing. */
  songSettings: Record<string, SongSettings>;
}

/**
 * The swap boundary. M1 ships an in-memory local implementation (with localStorage
 * persistence for songSettings); M2 replaces it with a Yjs/CRDT-backed one behind this
 * same interface, so no consumer changes — and the per-song overrides become shared.
 * `subscribe` follows the Svelte store contract so components can use `$store`.
 */
export interface SessionStore {
  subscribe(run: (state: SessionState) => void): () => void;
  getState(): SessionState;
  setCurrentSong(songId: string): void;
  setTransport(transport: Transport): void;
  /** Overrides for a song, or an empty object if none are set. */
  getSongSettings(songId: string): SongSettings;
  /** Merge in overrides (only defined fields); persists. */
  setSongSetting(songId: string, patch: Partial<SongSettings>): void;
  /** Clear one field (or all, if field omitted) → reverts to the canonical default. */
  resetSongSetting(songId: string, field?: keyof SongSettings): void;
}
