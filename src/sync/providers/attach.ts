import type * as Y from 'yjs';
import type { ProviderFactory, SyncProvider } from './types';
export type { ProviderFactory, SyncProvider } from './types';

export function attachProviders(
  doc: Y.Doc,
  bandCode: string,
  factories: ProviderFactory[],
): () => void {
  const built: SyncProvider[] = [];
  for (const make of factories) {
    try {
      built.push(make(doc, bandCode));
    } catch (e) {
      console.warn(`[sync] provider failed to attach, skipping:`, e);
    }
  }
  return () => built.forEach((p) => p.disconnect());
}
