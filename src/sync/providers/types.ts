import type * as Y from 'yjs';
export interface SyncProvider {
  name: string;
  disconnect(): void;
}
export type ProviderFactory = (doc: Y.Doc, bandCode: string) => SyncProvider;
