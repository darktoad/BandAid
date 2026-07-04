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
    const cleanup = attachProviders(doc, 'band-code', [f1, f2]);
    cleanup();
    expect(d1).toHaveBeenCalledOnce();
    expect(d2).toHaveBeenCalledOnce();
  });

  it('skips a factory that throws and still attaches the others', () => {
    const doc = new Y.Doc();
    const ok = vi.fn();
    const bad: ProviderFactory = () => {
      throw new Error('no network');
    };
    const good: ProviderFactory = () => ({ name: 'good', disconnect: ok });
    const cleanup = attachProviders(doc, 'x', [bad, good]);
    cleanup();
    expect(ok).toHaveBeenCalledOnce();
  });
});
