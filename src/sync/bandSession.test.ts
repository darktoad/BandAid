import { describe, it, expect, vi } from 'vitest';
import * as Y from 'yjs';
import { createBandSession } from './bandSession';
import type { ProviderFactory } from './providers/types';

function fakeStorage(seed: Record<string, string> = {}) {
  const m = new Map(Object.entries(seed));
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    dump: () => Object.fromEntries(m),
  };
}

function spyFactory() {
  const attached: string[] = [];
  const disconnected = vi.fn();
  const factory: ProviderFactory = (_doc, code) => {
    attached.push(code);
    return { name: 'spy', disconnect: disconnected };
  };
  return { factory, attached, disconnected };
}

function fakeAwareness() {
  const states = new Map<number, Record<string, unknown>>();
  const listeners = new Set<() => void>();
  return {
    setLocalStateField(field: string, value: unknown) {
      states.set(1, { ...(states.get(1) ?? {}), [field]: value });
      listeners.forEach((l) => l());
    },
    getStates: () => states,
    on: (_e: 'change', cb: () => void) => void listeners.add(cb),
    off: (_e: 'change', cb: () => void) => void listeners.delete(cb),
    /** Test helper: a remote device's awareness state landing/leaving. */
    setRemote(id: number, state: Record<string, unknown> | null) {
      if (state === null) states.delete(id);
      else states.set(id, state);
      listeners.forEach((l) => l());
    },
  };
}

function setup(
  seed: Record<string, string> = {},
  autoAttach = false,
  awareness?: ReturnType<typeof fakeAwareness>,
) {
  const storage = fakeStorage(seed);
  const spy = spyFactory();
  const session = createBandSession({
    doc: new Y.Doc(),
    room: 'soundcheck',
    factories: [spy.factory],
    storage,
    autoAttach,
    awareness,
  });
  return { session, storage, ...spy };
}

describe('createBandSession', () => {
  it('a truly fresh install stays local: no providers, session off', () => {
    const { session, attached } = setup();
    expect(session.isOn()).toBe(false);
    expect(attached).toEqual([]);
    expect(session.getState().status).toEqual({ providers: {} });
  });

  it('an explicitly configured band (autoAttach) attaches at creation, session stays off', () => {
    const { session, attached } = setup({}, true);
    expect(attached).toEqual(['soundcheck']); // Band Book syncs…
    expect(session.isOn()).toBe(false); // …but nobody joined the live session
  });

  it('a previous session join resumes attached AND joined (iOS tab reloads)', () => {
    const { session, attached } = setup({ 'bandaid.syncOn.v1': '1' });
    expect(session.isOn()).toBe(true);
    expect(attached).toEqual(['soundcheck']);
  });

  it('a previous session leave still attaches (Band Book), just not joined', () => {
    const { session, attached } = setup({ 'bandaid.syncOn.v1': '0' });
    expect(session.isOn()).toBe(false);
    expect(attached).toEqual(['soundcheck']); // leaving the session ≠ leaving the book
  });

  it('setOn(true) attaches (first join configures) and persists', () => {
    const { session, attached, storage } = setup();
    session.setOn(true);
    expect(attached).toEqual(['soundcheck']);
    expect(storage.dump()['bandaid.syncOn.v1']).toBe('1');
  });

  it('setOn(false) leaves the session but keeps the network attached', () => {
    const { session, disconnected, storage } = setup();
    session.setOn(true);
    session.setOn(false);
    expect(disconnected).not.toHaveBeenCalled(); // Band Book stays connected
    expect(storage.dump()['bandaid.syncOn.v1']).toBe('0');
    expect(session.isOn()).toBe(false);
  });

  it('setRoom to a new code reconnects there; the session flag is untouched', () => {
    const { session, attached, disconnected } = setup({}, true);
    session.setRoom('rhythm-cats');
    expect(disconnected).toHaveBeenCalledOnce();
    expect(attached).toEqual(['soundcheck', 'rhythm-cats']);
    expect(session.isOn()).toBe(false);
  });

  it('setRoom on an unconfigured device attaches (naming the band configures it)', () => {
    const { session, attached } = setup();
    session.setRoom('rhythm-cats');
    expect(attached).toEqual(['rhythm-cats']);
  });

  it('setRoom with the same code is attach-idempotent (no reconnect churn)', () => {
    const { session, attached, disconnected } = setup({}, true);
    session.setRoom('soundcheck');
    expect(attached).toEqual(['soundcheck']);
    expect(disconnected).not.toHaveBeenCalled();
  });

  it('notifies subscribers immediately and on session changes', () => {
    const { session } = setup();
    const seen: boolean[] = [];
    session.subscribe((s) => seen.push(s.on));
    expect(seen).toEqual([false]);
    session.setOn(true);
    expect(seen).toContain(true);
  });

  it('setOn is idempotent', () => {
    const { session, attached } = setup();
    session.setOn(true);
    session.setOn(true);
    expect(attached).toEqual(['soundcheck']);
  });

  it('destroy disconnects the providers', () => {
    const { session, disconnected } = setup({}, true);
    session.destroy();
    expect(disconnected).toHaveBeenCalledOnce();
  });
});

describe('session count (awareness)', () => {
  it('publishes the joined flag on join and leave', () => {
    const aw = fakeAwareness();
    const { session } = setup({}, false, aw);
    expect(aw.getStates().get(1)).toEqual({ session: { joined: false } });
    session.setOn(true);
    expect(aw.getStates().get(1)).toEqual({ session: { joined: true } });
    session.setOn(false);
    expect(aw.getStates().get(1)).toEqual({ session: { joined: false } });
  });

  it('counts every device whose awareness says joined, self included', () => {
    const aw = fakeAwareness();
    const { session } = setup({}, false, aw);
    expect(session.getState().sessionCount).toBe(0);
    session.setOn(true);
    expect(session.getState().sessionCount).toBe(1); // just this device
    aw.setRemote(2, { session: { joined: true } });
    expect(session.getState().sessionCount).toBe(2); // the band is in
    aw.setRemote(3, { session: { joined: false } }); // online, not joined
    expect(session.getState().sessionCount).toBe(2);
  });

  it('emits to subscribers when a remote device joins or leaves the session', () => {
    const aw = fakeAwareness();
    const { session } = setup({}, false, aw);
    const counts: number[] = [];
    session.subscribe((s) => counts.push(s.sessionCount));
    aw.setRemote(2, { session: { joined: true } });
    aw.setRemote(2, null); // device gone (awareness expiry)
    expect(counts).toContain(1);
    expect(counts.at(-1)).toBe(0);
  });

  it('a resumed session join publishes joined at creation', () => {
    const aw = fakeAwareness();
    setup({ 'bandaid.syncOn.v1': '1' }, false, aw);
    expect(aw.getStates().get(1)).toEqual({ session: { joined: true } });
  });

  it('works without awareness (count is just self-derived)', () => {
    const { session } = setup();
    session.setOn(true);
    expect(session.getState().sessionCount).toBe(1);
  });
});
