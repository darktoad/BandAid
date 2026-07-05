import YProvider from 'y-partyserver/provider';
import type { ConnectionStatus, ProviderFactory } from './types';
/** host: the deployed worker host, e.g. "bandaid-sync.<account>.workers.dev". */
export function partyserverProvider(host: string): ProviderFactory {
  return (doc, bandCode) => {
    // `party` must match the Durable Object binding name, kebab-cased
    // (binding `Corrections` → party `corrections`, Task 7).
    const p = new YProvider(host, bandCode, doc, { party: 'corrections' });
    let status: ConnectionStatus = 'connecting';
    p.on('status', ({ status: s }: { status: ConnectionStatus }) => {
      status = s;
    });
    return {
      name: 'partyserver',
      disconnect: () => p.disconnect(),
      getStatus: () => status,
      onStatusChange: (cb) => {
        const handler = ({ status: s }: { status: ConnectionStatus }) => cb(s);
        p.on('status', handler);
        return () => p.off('status', handler);
      },
    };
  };
}
