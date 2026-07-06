import { describe, it, expect } from 'vitest';
import { createIntentFollower } from './follower';

interface FakeStamp {
  authorId: string;
  issuedAt: number;
  value: string;
}
const stamp = (over: Partial<FakeStamp> = {}): FakeStamp => ({
  authorId: 'peer', issuedAt: 1_000, value: 'x', ...over,
});

function harness(over: { enabledRef?: { on: boolean }; shouldApply?: (s: FakeStamp) => boolean } = {}) {
  const applied: FakeStamp[] = [];
  const follower = createIntentFollower<FakeStamp>({
    authorId: 'me',
    enabled: over.enabledRef ? () => over.enabledRef!.on : undefined,
    shouldApply: over.shouldApply,
    apply: (s) => applied.push(s),
  });
  return { follower, applied };
}

describe('intent follower (generic apply rules)', () => {
  it('applies a newer peer stamp; drops older or equal issuedAt', () => {
    const { follower, applied } = harness();
    follower.receive(stamp({ issuedAt: 1_000 }));
    follower.receive(stamp({ issuedAt: 900 }));
    follower.receive(stamp({ issuedAt: 1_000 }));
    expect(applied).toHaveLength(1);
    follower.receive(stamp({ issuedAt: 1_001 }));
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

  it('disabled: never applies (the boot-with-stale-IndexedDB-state case)', () => {
    const enabledRef = { on: false };
    const { follower, applied } = harness({ enabledRef });
    follower.receive(stamp({ issuedAt: 5_000 })); // yesterday's stamp arriving at boot
    expect(applied).toHaveLength(0);
  });

  it('a stamp ignored while disabled does not advance the cursor — enabling later still joins', () => {
    const enabledRef = { on: false };
    const { follower, applied } = harness({ enabledRef });
    follower.receive(stamp({ issuedAt: 5_000 }));
    enabledRef.on = true;
    // The band's current state re-arrives via the network merge after joining.
    follower.receive(stamp({ issuedAt: 5_000 }));
    expect(applied).toHaveLength(1);
  });

  it('own stamps advance the cursor even while disabled: rejoining cannot rewind past own actions', () => {
    const enabledRef = { on: false };
    const { follower, applied } = harness({ enabledRef });
    follower.receive(stamp({ authorId: 'me', issuedAt: 9_000 })); // solo action while off
    enabledRef.on = true;
    follower.receive(stamp({ issuedAt: 8_000 })); // peer stamp older than my own action
    expect(applied).toHaveLength(0);
    follower.receive(stamp({ issuedAt: 9_500 }));
    expect(applied).toHaveLength(1);
  });

  it('shouldApply filters without touching the cursor', () => {
    const { follower, applied } = harness({ shouldApply: (s) => s.value === 'this-song' });
    follower.receive(stamp({ issuedAt: 2_000, value: 'other-song' }));
    expect(applied).toHaveLength(0);
    follower.receive(stamp({ issuedAt: 1_000, value: 'this-song' })); // older but for us
    expect(applied).toHaveLength(1);
  });

  it('ignores null', () => {
    const { follower, applied } = harness();
    follower.receive(null);
    expect(applied).toHaveLength(0);
  });
});
