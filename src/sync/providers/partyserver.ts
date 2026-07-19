import YProvider from 'y-partyserver/provider';
import type { ConnectionStatus, ProviderFactory } from './types';
/** host: the deployed worker host, e.g. "bandaid-sync.<account>.workers.dev". */
export function partyserverProvider(host: string): ProviderFactory {
  return (doc, bandCode, awareness) => {
    // `party` must match the Durable Object binding name, kebab-cased
    // (binding `Corrections` → party `corrections`, Task 7).
    const p = new YProvider(host, bandCode, doc, { party: 'corrections', ...(awareness ? { awareness } : {}) });
    let status: ConnectionStatus = 'connecting';
    p.on('status', ({ status: s }: { status: ConnectionStatus }) => {
      status = s;
    });
    return {
      name: 'partyserver',
      // destroy(), not disconnect(): disconnect leaves the doc update handler, the
      // resync interval, and our status listener attached — toggling sync (or renaming
      // the band) would accumulate one orphaned set per cycle.
      disconnect: () => p.destroy(),
      getStatus: () => status,
      onStatusChange: (cb) => {
        const handler = ({ status: s }: { status: ConnectionStatus }) => cb(s);
        p.on('status', handler);
        return () => p.off('status', handler);
      },
    };
  };
}
