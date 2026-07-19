import { describe, it, expect, vi } from 'vitest';
import * as Y from 'yjs';
import { attachProviders, type ProviderFactory } from './attach';

describe('attachProviders', () => {
  it('builds every provider and disconnects them all', () => {
    const doc = new Y.Doc();
    const d1 = vi.fn();
    const d2 = vi.fn();
    const f1: ProviderFactory = () => ({ name: 'a', disconnect: d1 });
    const f2: ProviderFactory = () => ({ name: 'b', disconnect: d2 });
    const sync = attachProviders(doc, 'band-code', [f1, f2]);
    sync.disconnect();
    expect(d1).toHaveBeenCalledOnce();
    expect(d2).toHaveBeenCalledOnce();
  });

  it('forwards the shared awareness instance to every factory', () => {
    const seen: unknown[] = [];
    const factory: ProviderFactory = (_doc, _code, awareness) => {
      seen.push(awareness);
      return { name: 'spy', disconnect: () => {} };
    };
    const fakeAwareness = { the: 'awareness' } as never;
    attachProviders(new Y.Doc(), 'band', [factory], fakeAwareness);
    expect(seen).toEqual([fakeAwareness]);
  });

  it('skips a factory that throws and still attaches the others', () => {
    const doc = new Y.Doc();
    const ok = vi.fn();
    const bad: ProviderFactory = () => {
      throw new Error('no network');
    };
    const good: ProviderFactory = () => ({ name: 'good', disconnect: ok });
    const sync = attachProviders(doc, 'x', [bad, good]);
    sync.disconnect();
    expect(ok).toHaveBeenCalledOnce();
  });

  it('local writes succeed immediately even when a provider is stuck disconnected', () => {
    const doc = new Y.Doc();
    const stuck: ProviderFactory = () => ({
      name: 'stuck',
      disconnect: vi.fn(),
      getStatus: () => 'connecting',
      // Never calls back — this provider never reaches connected.
      onStatusChange: () => () => {},
    });
    attachProviders(doc, 'x', [stuck]);
    doc.getMap('corrections').set('c1', { text: 'a correction' });
    expect(doc.getMap('corrections').get('c1')).toEqual({ text: 'a correction' });
  });

  it('seeds status from each provider and propagates changes', () => {
    const doc = new Y.Doc();
    let statusCb: ((status: 'connected' | 'disconnected') => void) | undefined;
    const withStatus: ProviderFactory = () => ({
      name: 'withStatus',
      disconnect: vi.fn(),
      getStatus: () => 'connecting',
      onStatusChange: (cb) => {
        statusCb = cb;
        return () => {
          statusCb = undefined;
        };
      },
    });
    const withoutStatus: ProviderFactory = () => ({ name: 'withoutStatus', disconnect: vi.fn() });

    const sync = attachProviders(doc, 'x', [withStatus, withoutStatus]);
    expect(sync.getStatus()).toEqual({ providers: { withStatus: 'connecting', withoutStatus: 'unavailable' } });

    const seen: Array<Record<string, string>> = [];
    sync.onStatusChange((status) => seen.push(status.providers));
    statusCb?.('connected');
    expect(seen.at(-1)).toEqual({ withStatus: 'connected', withoutStatus: 'unavailable' });
    expect(sync.getStatus().providers.withStatus).toBe('connected');
  });
});
