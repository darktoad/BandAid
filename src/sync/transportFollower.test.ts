// src/sync/transportFollower.test.ts
import { describe, it, expect } from 'vitest';
import { createTransportFollower } from './transportFollower';
import type { SharedTransportIntent } from '../session/types';
import { createSkewLog } from './skewLog';

const stamp = (over: Partial<SharedTransportIntent> = {}): SharedTransportIntent => ({
  songId: 'tune', playing: true, startBar: 1, startTimestamp: 1_000, tempo: 120,
  issuedAt: 1_000, authorId: 'peer', kind: 'play', ...over,
});

function harness() {
  const applied: SharedTransportIntent[] = [];
  const skew = createSkewLog();
  const follower = createTransportFollower({
    songId: 'tune',
    authorId: 'me',
    apply: (s) => applied.push(s),
    skewLog: skew,
    now: () => 1_250,
  });
  return { follower, applied, skew };
}

describe('transport follower', () => {
  it('applies a newer peer intent and records a skew sample', () => {
    const { follower, applied, skew } = harness();
    follower.receive(stamp());
    expect(applied).toHaveLength(1);
    expect(skew.samples()).toEqual([{ kind: 'play', issuedAt: 1_000, receivedAt: 1_250, deltaMs: 250 }]);
  });

  it('newest press wins: older or equal issuedAt is dropped', () => {
    const { follower, applied } = harness();
    follower.receive(stamp({ issuedAt: 1_000 }));
    follower.receive(stamp({ issuedAt: 900, kind: 'pause', playing: false }));
    follower.receive(stamp({ issuedAt: 1_000, kind: 'pause', playing: false }));
    expect(applied).toHaveLength(1);
    follower.receive(stamp({ issuedAt: 1_001, kind: 'pause', playing: false }));
    expect(applied).toHaveLength(2);
  });

  it('echo guard: own stamps advance the cursor without applying', () => {
    const { follower, applied } = harness();
    follower.receive(stamp({ authorId: 'me', issuedAt: 2_000 }));
    expect(applied).toHaveLength(0);
    follower.receive(stamp({ issuedAt: 1_500 })); // peer stamp older than my own action
    expect(applied).toHaveLength(0);
    follower.receive(stamp({ issuedAt: 2_500 }));
    expect(applied).toHaveLength(1);
  });

  it('ignores null and other songs’ stamps', () => {
    const { follower, applied } = harness();
    follower.receive(null);
    follower.receive(stamp({ songId: 'other-tune' }));
    expect(applied).toHaveLength(0);
  });
});
