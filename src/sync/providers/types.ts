import type * as Y from 'yjs';

/** 'unavailable' means the provider has no network concept (e.g. indexeddb). */
export type ConnectionStatus = 'unavailable' | 'connecting' | 'connected' | 'disconnected';

export interface SyncProvider {
  name: string;
  disconnect(): void;
  /** Providers with no network concept (e.g. indexeddb) may omit this entirely. */
  getStatus?(): ConnectionStatus;
  onStatusChange?(cb: (status: ConnectionStatus) => void): () => void;
}
export type ProviderFactory = (doc: Y.Doc, bandCode: string) => SyncProvider;
