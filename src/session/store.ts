import { writable } from 'svelte/store';
import type { SessionState, SessionStore, SongSettings, Transport } from './types';

const EMPTY: SessionState = { currentSongId: null, transport: null, songSettings: {} };

// Per-song overrides persist across reloads on this device (M1). In M2 the shared
// store supersedes this; until then localStorage is the durable layer. Versioned key
// so the shape can evolve without resurrecting stale data.
const STORAGE_KEY = 'bandaid.songSettings.v1';

function loadPersisted(): Record<string, SongSettings> {
  try {
    if (typeof localStorage === 'undefined') return {};
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, SongSettings>) : {};
  } catch {
    return {};
  }
}

function persist(songSettings: Record<string, SongSettings>): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(songSettings));
    }
  } catch {
    // storage full / disabled — overrides simply won't persist this session.
  }
}

/** Drop keys whose value is undefined so "no override" never serializes as a field. */
function clean(s: SongSettings): SongSettings {
  const out: SongSettings = {};
  if (s.tempoPct !== undefined) out.tempoPct = s.tempoPct;
  if (s.transpose !== undefined) out.transpose = s.transpose;
  return out;
}

/**
 * M1 in-memory session store (with persisted per-song overrides). Backs the
 * `SessionStore` interface with a Svelte writable so components get `$store`
 * reactivity for free. In M2 this file is replaced by a Yjs-backed implementation of
 * the same interface — consumers (renderer, transport, browsing) do not change.
 */
export function createLocalSessionStore(initial: Partial<SessionState> = {}): SessionStore {
  let state: SessionState = {
    ...EMPTY,
    ...initial,
    // Persisted overrides load first; an explicit `initial.songSettings` wins (tests).
    songSettings: { ...loadPersisted(), ...(initial.songSettings ?? {}) },
  };
  const { subscribe, set } = writable<SessionState>(state);

  const commit = (next: SessionState) => {
    state = next;
    set(state);
  };

  return {
    subscribe,
    getState: () => state,
    setCurrentSong(songId: string) {
      commit({ ...state, currentSongId: songId });
    },
    setTransport(transport: Transport) {
      commit({ ...state, transport });
    },
    getSongSettings: (songId: string) => state.songSettings[songId] ?? {},
    setSongSetting(songId: string, patch: Partial<SongSettings>) {
      const merged = clean({ ...(state.songSettings[songId] ?? {}), ...patch });
      const songSettings = { ...state.songSettings, [songId]: merged };
      persist(songSettings);
      commit({ ...state, songSettings });
    },
    resetSongSetting(songId: string, field?: keyof SongSettings) {
      const current = state.songSettings[songId];
      if (!current) return;
      const songSettings = { ...state.songSettings };
      if (field) {
        const next = clean({ ...current, [field]: undefined });
        if (Object.keys(next).length === 0) delete songSettings[songId];
        else songSettings[songId] = next;
      } else {
        delete songSettings[songId];
      }
      persist(songSettings);
      commit({ ...state, songSettings });
    },
  };
}
