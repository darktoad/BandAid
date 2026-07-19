import { describe, it, expect, vi } from 'vitest';
import * as Y from 'yjs';
import { webrtcProvider } from './webrtc';

// Capture the event handlers the adapter registers so tests can drive y-webrtc's
// 'peers' / 'synced' events without any real networking.
const handlers = new Map<string, (payload: unknown) => void>();
let lastOptions: Record<string, unknown> | undefined;
vi.mock('y-webrtc', () => ({
  WebrtcProvider: class {
    constructor(_room: string, _doc: unknown, options?: Record<string, unknown>) {
      lastOptions = options;
    }
    on(event: string, cb: (payload: unknown) => void) {
      handlers.set(event, cb);
    }
    off(event: string) {
      handlers.delete(event);
    }
    destroy() {}
  },
}));

function setup() {
  handlers.clear();
  const seen: string[] = [];
  const p = webrtcProvider(new Y.Doc(), 'test-band');
  p.onStatusChange!((s) => seen.push(s));
  const peers = (webrtcPeers: string[], bcPeers: string[]) =>
    handlers.get('peers')!({ webrtcPeers, bcPeers });
  const synced = (s: boolean) => handlers.get('synced')!({ synced: s });
  return { p, seen, peers, synced };
}

describe('webrtcProvider', () => {
  it('hands the shared awareness to the underlying WebrtcProvider', () => {
    const fakeAwareness = { the: 'awareness' } as never;
    webrtcProvider(new Y.Doc(), 'test-band', fakeAwareness);
    expect(lastOptions?.awareness).toBe(fakeAwareness);
  });
});

describe('webrtcProvider status', () => {
  it('starts alone (attached and listening, no peers of either kind) — a steady state, not liminal', () => {
    const { p } = setup();
    expect(p.getStatus!()).toBe('alone');
  });

  it('a BroadcastChannel peer (another tab, same origin) counts as connected', () => {
    // Same-origin tabs sync over BC without any signaling server — the doc really is
    // shared, so the badge must say so (two-tab dev verification depends on it).
    const { p, peers } = setup();
    peers([], ['tab-b']);
    expect(p.getStatus!()).toBe('connected');
  });

  it('a webrtc peer mid-handshake is the one genuinely liminal state: connecting', () => {
    const { p, peers, synced } = setup();
    peers(['peer-1'], []);
    expect(p.getStatus!()).toBe('connecting'); // found, sync handshake in flight
    synced(true);
    expect(p.getStatus!()).toBe('connected');
  });

  it('returns to alone when the last peer of both kinds leaves', () => {
    const { p, peers, synced } = setup();
    peers(['peer-1'], ['tab-b']);
    synced(true);
    expect(p.getStatus!()).toBe('connected');
    peers([], []);
    expect(p.getStatus!()).toBe('alone');
  });
});
