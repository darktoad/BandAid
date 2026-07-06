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

function setup(seed: Record<string, string> = {}) {
  const storage = fakeStorage(seed);
  const spy = spyFactory();
  const session = createBandSession({
    doc: new Y.Doc(),
    room: 'soundcheck',
    factories: [spy.factory],
    storage,
  });
  return { session, storage, ...spy };
}

describe('createBandSession', () => {
  it('starts local on a fresh install: no providers attached, status empty', () => {
    const { session, attached } = setup();
    expect(session.isOn()).toBe(false);
    expect(attached).toEqual([]);
    expect(session.getState().status).toEqual({ providers: {} });
  });

  it('setOn(true) connects to the room and persists the opt-in', () => {
    const { session, attached, storage } = setup();
    session.setOn(true);
    expect(attached).toEqual(['soundcheck']);
    expect(storage.dump()['bandaid.syncOn.v1']).toBe('1');
  });

  it('setOn(false) disconnects and persists the opt-out', () => {
    const { session, disconnected, storage } = setup();
    session.setOn(true);
    session.setOn(false);
    expect(disconnected).toHaveBeenCalledOnce();
    expect(storage.dump()['bandaid.syncOn.v1']).toBe('0');
    expect(session.getState().status).toEqual({ providers: {} }); // back to "Local only"
  });

  it('resumes a previous opt-in at creation (iOS tab reloads must not drop the band)', () => {
    const { session, attached } = setup({ 'bandaid.syncOn.v1': '1' });
    expect(session.isOn()).toBe(true);
    expect(attached).toEqual(['soundcheck']);
  });

  it('a previous opt-out stays off', () => {
    const { session, attached } = setup({ 'bandaid.syncOn.v1': '0' });
    expect(session.isOn()).toBe(false);
    expect(attached).toEqual([]);
  });

  it('setRoom while on moves rooms immediately; while off just remembers', () => {
    const { session, attached, disconnected } = setup();
    session.setRoom('rhythm-cats'); // off: no connection to move
    expect(attached).toEqual([]);
    session.setOn(true);
    expect(attached).toEqual(['rhythm-cats']);
    session.setRoom('the-regulars');
    expect(disconnected).toHaveBeenCalledOnce();
    expect(attached).toEqual(['rhythm-cats', 'the-regulars']);
  });

  it('setRoom with the same code is a no-op (no reconnect churn)', () => {
    const { session, attached } = setup();
    session.setOn(true);
    session.setRoom('soundcheck');
    expect(attached).toEqual(['soundcheck']);
  });

  it('notifies subscribers immediately and on every change', () => {
    const { session } = setup();
    const seen: boolean[] = [];
    session.subscribe((s) => seen.push(s.on));
    expect(seen).toEqual([false]);
    session.setOn(true);
    expect(seen).toEqual([false, true]);
  });

  it('setOn is idempotent: repeating the current state neither reconnects nor re-emits', () => {
    const { session, attached } = setup();
    session.setOn(true);
    session.setOn(true);
    expect(attached).toEqual(['soundcheck']);
  });
});
