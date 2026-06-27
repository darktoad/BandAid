import { writable } from 'svelte/store';
import type { SessionState, SessionStore, Transport } from './types';

const EMPTY: SessionState = { currentSongId: null, transport: null };

/**
 * M1 in-memory session store. Backs the `SessionStore` interface with a Svelte
 * writable so components get `$store` reactivity for free. In M2 this file is
 * replaced by a Yjs-backed implementation of the same interface — consumers
 * (renderer, transport, browsing) do not change.
 */
export function createLocalSessionStore(initial: Partial<SessionState> = {}): SessionStore {
  let state: SessionState = { ...EMPTY, ...initial };
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
  };
}
