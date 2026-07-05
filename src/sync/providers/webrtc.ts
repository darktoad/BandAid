import { WebrtcProvider } from 'y-webrtc';
import type { ProviderFactory } from './types';
export const webrtcProvider: ProviderFactory = (doc, bandCode) => {
  const p = new WebrtcProvider(`bandaid-${bandCode}`, doc);
  return {
    name: 'webrtc',
    disconnect: () => p.destroy(),
    getStatus: () => (p.connected ? 'connected' : 'connecting'),
    onStatusChange: (cb) => {
      const handler = ({ connected }: { connected: boolean }) => cb(connected ? 'connected' : 'disconnected');
      p.on('status', handler);
      return () => p.off('status', handler);
    },
  };
};
