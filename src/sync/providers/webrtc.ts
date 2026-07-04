import { WebrtcProvider } from 'y-webrtc';
import type { ProviderFactory } from './types';
export const webrtcProvider: ProviderFactory = (doc, bandCode) => {
  const p = new WebrtcProvider(`bandaid-${bandCode}`, doc);
  return { name: 'webrtc', disconnect: () => p.destroy() };
};
