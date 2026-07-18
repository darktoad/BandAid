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

function setup(seed: Record<string, string> = {}, autoAttach = false) {
  const storage = fakeStorage(seed);
  const spy = spyFactory();
  const session = createBandSession({
    doc: new Y.Doc(),
    room: 'soundcheck',
    factories: [spy.factory],
    storage,
    autoAttach,
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
