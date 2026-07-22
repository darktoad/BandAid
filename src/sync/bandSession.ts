import type * as Y from 'yjs';
import { attachProviders, type AttachedSync, type SyncStatus } from './providers/attach';
import type { ProviderFactory } from './providers/types';
import { createChannel } from './channel';
import { readItem, writeItem, safeStorage, type StorageLike } from './storage';

const SYNC_ON_KEY = 'bandaid.syncOn.v1';

/**
 * Owns the network lifecycle of the shared doc, split in two tiers (Band Book design,
 * spec 2026-07-18 Part 1):
 *
 *  - NETWORK ATTACH (Band Book): providers attach whenever a band room is CONFIGURED —
 *    an explicitly saved band name (autoAttach) or any previous use of the session
 *    toggle (the syncOn key exists, either value). Once attached, durable Band Book
 *    data (set lists, song settings, corrections) syncs whenever the device is online.
 *    Only destroy() detaches. A truly fresh install stays local: the DEFAULT band name
 *    is shared by every install and must never connect on its own.
 *
 *  - SESSION (live layer): the on/off flag — persisted so an iOS tab reload doesn't
 *    drop a joined device mid-rehearsal — gates only what publishes/follows live
 *    stamps (transport + song follow). It no longer touches the network.
 */
export interface BandSessionState {
  on: boolean;
  status: SyncStatus;
  /** Devices currently joined to the live session (this one included when joined). */
  sessionCount: number;
}

/** The narrow slice of y-protocols' Awareness that bandSession uses — the real class
 *  satisfies it structurally; tests fake it. */
export interface AwarenessLike {
  setLocalStateField(field: string, value: unknown): void;
  getStates(): Map<number, Record<string, unknown> | null>;
  on(event: 'change', cb: () => void): void;
  off(event: 'change', cb: () => void): void;
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
  /** A band room is explicitly configured — attach the providers at creation. */
  autoAttach?: boolean;
  /** Shared awareness instance; carries the ephemeral session-joined flag. */
  awareness?: AwarenessLike;
}): BandSession {
  const storage = opts.storage === undefined ? safeStorage() : opts.storage;
  const awareness = opts.awareness;
  let room = opts.room;
  let on = false;
  let attached: AttachedSync | undefined;
  let unsubStatus: (() => void) | undefined;

  // Ephemeral by design: awareness states vanish with the device, so the count can
  // never go stale the way doc data could. No awareness (tests, degraded boot) →
  // fall back to counting just this device.
  const sessionCount = (): number => {
    if (!awareness) return on ? 1 : 0;
    let n = 0;
    for (const s of awareness.getStates().values()) {
      if ((s as { session?: { joined?: boolean } } | null)?.session?.joined) n++;
    }
    return n;
  };

  const getState = (): BandSessionState => ({
    on,
    status: attached?.getStatus() ?? { providers: {} },
    sessionCount: sessionCount(),
  });
  const channel = createChannel(getState);

  // onStatusChange delivers the current status immediately on subscribe, so attaching
  // itself emits the freshly-connected state.
  function ensureAttached() {
    if (attached) return;
    // AwarenessLike is the narrow structural view of the real Awareness the App passes.
    attached = attachProviders(opts.doc, room, opts.factories, awareness as never);
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
    awareness?.setLocalStateField('session', { joined: next });
    // Joining is a configuring act (the user chose a room to join). Leaving the
    // session never detaches — the Band Book keeps syncing.
    if (next) ensureAttached();
    channel.emit();
  }

  // Attach policy at creation — see the header comment.
  if (opts.autoAttach || readItem(storage, SYNC_ON_KEY) !== null) ensureAttached();
  // Resume a previous session join across reloads.
  if (readItem(storage, SYNC_ON_KEY) === '1') on = true;
  // Publish the initial joined flag (covers a resumed session), and re-emit whenever
  // any device's awareness changes — that's what moves the session count.
  awareness?.setLocalStateField('session', { joined: on });
  const onAwareness = () => channel.emit();
  awareness?.on('change', onAwareness);

  return {
    getState,
    isOn: () => on,
    setOn,
    setRoom(code) {
      // An explicit room set is a configuring act: make sure we're attached even if
      // the code didn't change (e.g. re-confirming the prefilled name).
      if (code === room) {
        ensureAttached();
        return;
      }
      room = code;
      if (attached) disconnect();
      ensureAttached();
      channel.emit();
    },
    subscribe: channel.subscribe,
    destroy: () => {
      awareness?.off('change', onAwareness);
      disconnect();
    },
  };
}
