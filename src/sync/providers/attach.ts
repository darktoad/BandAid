import type * as Y from 'yjs';
import type { ConnectionStatus, ProviderFactory, SyncProvider } from './types';
import { createChannel } from '../channel';
export type { ConnectionStatus, ProviderFactory, SyncProvider } from './types';

/** Per-provider connection status, keyed by SyncProvider.name. */
export interface SyncStatus {
  providers: Record<string, ConnectionStatus>;
}

export interface AttachedSync {
  disconnect(): void;
  getStatus(): SyncStatus;
  /** Fires with the current status immediately on subscribe, then on every change. */
  onStatusChange(cb: (status: SyncStatus) => void): () => void;
}

/**
 * Attaches every provider and aggregates their connection status. Local doc reads/writes
 * are synchronous and never gated on this — a provider stuck disconnected only means its
 * transport never ships updates; it can't block the app.
 */
export function attachProviders(doc: Y.Doc, bandCode: string, factories: ProviderFactory[]): AttachedSync {
  const built: SyncProvider[] = [];
  const current: Record<string, ConnectionStatus> = {};
  const unsubscribes: Array<() => void> = [];
  const channel = createChannel((): SyncStatus => ({ providers: { ...current } }));

  for (const make of factories) {
    let p: SyncProvider;
    try {
      p = make(doc, bandCode);
    } catch (e) {
      console.warn(`[sync] provider failed to attach, skipping:`, e);
      continue;
    }
    built.push(p);
    current[p.name] = p.getStatus?.() ?? 'unavailable';
    if (p.onStatusChange) {
      unsubscribes.push(
        p.onStatusChange((status) => {
          current[p.name] = status;
          channel.emit();
        }),
      );
    }
  }

  return {
    disconnect: () => {
      unsubscribes.forEach((unsubscribe) => unsubscribe());
      built.forEach((p) => p.disconnect());
    },
    getStatus: () => ({ providers: { ...current } }),
    onStatusChange: channel.subscribe,
  };
}
