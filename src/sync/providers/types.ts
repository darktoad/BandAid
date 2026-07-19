import type * as Y from 'yjs';

/** 'unavailable' means the provider has no network concept (e.g. indexeddb).
 *  'alone' is a STEADY state: attached and listening, but nobody else is in the room —
 *  distinct from 'connecting', which is reserved for something genuinely in flight
 *  (dialing a relay, a peer sync handshake). The badge wording depends on this:
 *  a resting state must never read as liminal. */
export type ConnectionStatus = 'unavailable' | 'connecting' | 'connected' | 'disconnected' | 'alone';

export interface SyncProvider {
  name: string;
  disconnect(): void;
  /** Providers with no network concept (e.g. indexeddb) may omit this entirely. */
  getStatus?(): ConnectionStatus;
  onStatusChange?(cb: (status: ConnectionStatus) => void): () => void;
}
export type ProviderFactory = (doc: Y.Doc, bandCode: string) => SyncProvider;
