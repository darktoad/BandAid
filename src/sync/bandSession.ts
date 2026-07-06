import type * as Y from 'yjs';
import { attachProviders, type AttachedSync, type SyncStatus } from './providers/attach';
import type { ProviderFactory } from './providers/types';
import { createChannel } from './channel';
import { readItem, writeItem, safeStorage, type StorageLike } from './storage';

const SYNC_ON_KEY = 'bandaid.syncOn.v1';

/**
 * Owns the join/leave lifecycle of band sync: attach/detach the network providers,
 * switch rooms, aggregate status — and remember the choice. Sync stays strictly
 * opt-in (the key is only ever written by the user's own toggle), but once opted in
 * it survives reloads: iOS Safari silently reloads a backgrounded tab, and a
 * mid-rehearsal app switch must not drop the device out of the band.
 */
export interface BandSessionState {
  on: boolean;
  status: SyncStatus;
}

export interface BandSession {
  getState(): BandSessionState;
  isOn(): boolean;
  setOn(on: boolean): void;
  /** Move to a different room code; reconnects immediately if currently on. */
  setRoom(code: string): void;
  /** Fires with the current state immediately, then on every change. */
  subscribe(run: (state: BandSessionState) => void): () => void;
  destroy(): void;
}

export function createBandSession(opts: {
  doc: Y.Doc;
  room: string;
  factories: ProviderFactory[];
  storage?: StorageLike | null;
}): BandSession {
  const storage = opts.storage === undefined ? safeStorage() : opts.storage;
  let room = opts.room;
  let on = false;
  let attached: AttachedSync | undefined;
  let unsubStatus: (() => void) | undefined;

  const getState = (): BandSessionState => ({
    on,
    status: attached?.getStatus() ?? { providers: {} },
  });
  const channel = createChannel(getState);

  // onStatusChange delivers the current status immediately on subscribe, so connect()
  // itself emits the freshly-connected state — callers must not emit again after it.
  function connect() {
    attached = attachProviders(opts.doc, room, opts.factories);
    unsubStatus = attached.onStatusChange(() => channel.emit());
  }
  function disconnect() {
    unsubStatus?.();
    unsubStatus = undefined;
    attached?.disconnect();
    attached = undefined;
  }

  function setOn(next: boolean) {
    if (next === on) return;
    on = next;
    writeItem(storage, SYNC_ON_KEY, next ? '1' : '0');
    if (next) {
      connect();
    } else {
      disconnect();
      channel.emit();
    }
  }

  // Resume a previous opt-in. A fresh install has no key and starts local.
  if (readItem(storage, SYNC_ON_KEY) === '1') setOn(true);

  return {
    getState,
    isOn: () => on,
    setOn,
    setRoom(code) {
      if (code === room) return;
      room = code;
      if (on) {
        disconnect();
        connect();
      }
    },
    subscribe: channel.subscribe,
    destroy: disconnect,
  };
}
