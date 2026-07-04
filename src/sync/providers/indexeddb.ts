import { IndexeddbPersistence } from 'y-indexeddb';
import type { ProviderFactory } from './types';
export const indexeddbProvider: ProviderFactory = (doc, bandCode) => {
  const p = new IndexeddbPersistence(`bandaid-${bandCode}`, doc);
  return { name: 'indexeddb', disconnect: () => void p.destroy() };
};
