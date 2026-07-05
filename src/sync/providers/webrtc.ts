import { WebrtcProvider } from 'y-webrtc';
import type { ConnectionStatus, ProviderFactory } from './types';

/**
 * y-webrtc's own `connected` flag only means "looking for peers via signaling" (its
 * source doc comment: "connected doesn't mean that you are connected to any physical
 * peers") — it goes true the instant the room opens, with zero peers required. Reporting
 * that as our 'connected' status would tell a lone device "Synced" with nobody else in
 * the room, which is exactly what the sync badge exists to prevent. Track real peer
 * count (`peers`) and whether we've completed the Yjs sync handshake with one (`synced`)
 * instead — `synced` alone can get stuck true after the last peer leaves (a vacuous-truth
 * quirk in y-webrtc's own check with zero peers), so gate on peer count too.
 */
export const webrtcProvider: ProviderFactory = (doc, bandCode) => {
  const p = new WebrtcProvider(`bandaid-${bandCode}`, doc);
  let peerCount = 0;
  let synced = false;
  const status = (): ConnectionStatus => (peerCount > 0 && synced ? 'connected' : 'connecting');
  return {
    name: 'webrtc',
    disconnect: () => p.destroy(),
    getStatus: status,
    onStatusChange: (cb) => {
      const onPeers = ({ webrtcPeers }: { webrtcPeers: string[] }) => {
        peerCount = webrtcPeers.length;
        cb(status());
      };
      const onSynced = ({ synced: s }: { synced: boolean }) => {
        synced = s;
        cb(status());
      };
      p.on('peers', onPeers);
      p.on('synced', onSynced);
      return () => {
        p.off('peers', onPeers);
        p.off('synced', onSynced);
      };
    },
  };
};
