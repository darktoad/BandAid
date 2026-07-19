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
  let webrtcPeerCount = 0;
  let bcPeerCount = 0;
  let synced = false;
  // Two peer tiers: real WebRTC peers (other devices; count only after the Yjs sync
  // handshake, per above) and BroadcastChannel peers — other TABS on this same origin,
  // which y-webrtc syncs directly with no signaling server or handshake event. A BC
  // peer is a genuinely synced doc, so it counts as connected on its own (and it's
  // what two-tab dev verification sees).
  const status = (): ConnectionStatus =>
    (webrtcPeerCount > 0 && synced) || bcPeerCount > 0 ? 'connected' : 'connecting';
  return {
    name: 'webrtc',
    disconnect: () => p.destroy(),
    getStatus: status,
    onStatusChange: (cb) => {
      const onPeers = ({ webrtcPeers, bcPeers }: { webrtcPeers: string[]; bcPeers: string[] }) => {
        webrtcPeerCount = webrtcPeers.length;
        bcPeerCount = bcPeers.length;
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
