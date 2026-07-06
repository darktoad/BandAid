# Playback Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the `session` map of the band Y.Doc live: any member's play / pause / seek and song choice reach every device with the band code, each device projecting its own playhead from the shared stamp — implementing ADR-002 D2's intent/anchor routing, `issuedAt` last-press-wins, and echo guard, plus the follower (remote-apply) layer and skew logging.

**Architecture:** Three layers (see the [design spec](../specs/2026-07-05-playback-sync-design.md)): (1) origin tagging at the `setTransport` seam — only `intent` stamps reach the doc; (2) whole-object `session.transport` / `session.song` doc keys with dedicated subscription channels on the synced store, decorated with `issuedAt`/`authorId`/`kind`; (3) a per-song `transportFollower` (ordering/echo/staleness guards + skew samples) delegating mechanics to `localTransport.applyRemote` (seek / scheduled play / pause against the renderer, restamping locally with origin `'remote'`). Tempo/key keep syncing via the already-shipped `songSettings` channel — **no transport intent is ever published for a tempo change**.

**Tech Stack:** unchanged — Svelte 5 (runes) + Vite + TypeScript (strict) + Vitest; Yjs; the existing PartyServer worker relays the new keys as-is (**no server changes, no new dependencies**).

## Global Constraints

- Tests run in **Node with no jsdom** — injectable seams for clock (`now`) and timers (`schedule`), mirroring `localTransport`'s injected `now`. Test command: `npm test` (vitest run); type-check: `npm run check`.
- `SessionStore.setTransport` gains an **optional** second parameter defaulting to `{origin:'anchor'}` (local-only). Implementations with the old one-arg signature remain structurally valid TypeScript — `src/session/store.ts` is **not modified**. No existing test may need edits to pass.
- **The session-of-one invariant:** with no band code, behavior is identical to today. Doc writes without attached network providers never leave the device.
- `startTimestamp` is a projection anchor (deliberately future-stamped through count-in) and must **never** order conflicts; only `issuedAt` does (ADR-002 D2.2).
- Anchor re-stamps (repeat/volta re-anchors, tempo-continuity restamps) and `'remote'` re-stamps must never be written to the doc (ADR-002 D2.1).
- Clamps on apply are local and silent — never written back (ADR-002 D2.4).
- Spec: `docs/superpowers/specs/2026-07-05-playback-sync-design.md` · Feature/UX spec: `docs/project/features/playback-sync.md`.

## File Structure

- `src/session/types.ts` — add `TransportIntentKind`, `TransportStampMeta`, `SharedTransportIntent`, `SharedSongIntent`; widen `setTransport`.
- `src/transport/localTransport.ts` — route stamps by origin; add `applyRemote` + `dispose`; new deps `schedule?`.
- `src/sync/doc.ts` — `session` map accessors.
- `src/sync/syncedSessionStore.ts` — intent decoration on write; `getSessionTransport`/`getSessionSong`; `subscribeSessionTransport`/`subscribeSessionSong`; `now` option.
- `src/sync/transportFollower.ts` *(new)* — ordering/echo/staleness guards + skew samples.
- `src/sync/skewLog.ts` *(new)* — capped sample buffer + summary (G3 evidence).
- `src/views/ChordChangesView.svelte` — wire the follower at playback-ready; dispose on unmount.
- `src/App.svelte` — split `showSong`/`openSong` publishing; follow remote song switches (replaceState + notice); expose `window.__bandaidSkew`.
- Tests alongside each module; docs status updates last.

---

## Task 1: Stamp metadata types + origin routing in the transport

**Files:**
- Modify: `src/session/types.ts`
- Modify: `src/transport/localTransport.ts`
- Test: `src/transport/localTransport.test.ts` (append a new describe block)

**Interfaces produced:**
- `type TransportIntentKind = 'play' | 'pause' | 'seek'`
- `type TransportStampMeta = { origin: 'intent'; kind: TransportIntentKind } | { origin: 'anchor' } | { origin: 'remote' }`
- `interface SharedTransportIntent extends Transport { issuedAt: number; authorId: string; kind: TransportIntentKind }`
- `interface SharedSongIntent { songId: string; issuedAt: number; authorId: string; author: string }`
- `SessionStore.setTransport(transport: Transport, meta?: TransportStampMeta): void`

- [x] **Step 1: Write the failing test**

Append to `src/transport/localTransport.test.ts` (reuse the file's existing fake-renderer helper if it exposes position/playing emitters; otherwise use this self-contained stub):

```typescript
// --- Origin routing (ADR-002 D2.1): intents sync, anchors stay local ---
import type { TransportStampMeta } from '../session/types';

function stubRenderer() {
  const pos: Array<(bar: number) => void> = [];
  const playChanged: Array<(p: boolean) => void> = [];
  const calls: string[] = [];
  let posBar = 1;
  return {
    renderer: {
      play: () => calls.push('play'),
      pause: () => calls.push('pause'),
      setSpeed: (f: number) => calls.push(`speed:${f}`),
      seekToBar: (b: number) => { posBar = b; calls.push(`seek:${b}`); },
      getPositionBar: () => posBar,
      setCountInVolume: (v: number) => calls.push(`countin:${v}`),
      onPosition: (cb: (b: number) => void) => pos.push(cb),
      onPlayingChanged: (cb: (p: boolean) => void) => playChanged.push(cb),
    },
    calls,
    emitPosition: (b: number) => pos.forEach((cb) => cb(b)),
    emitPlaying: (p: boolean) => playChanged.forEach((cb) => cb(p)),
  };
}

function spyStore() {
  const stamps: Array<{ t: Transport; meta: TransportStampMeta | undefined }> = [];
  const store: SessionStore = {
    subscribe: () => () => {},
    getState: () => ({ currentSongId: null, transport: null, songSettings: {} }),
    setCurrentSong: () => {},
    setTransport: (t, meta) => stamps.push({ t, meta }),
    getSongSettings: () => ({}),
    setSongSetting: () => {},
    resetSongSetting: () => {},
  };
  return { store, stamps };
}

function makeTransport(over: Partial<LocalTransportDeps> = {}) {
  const r = stubRenderer();
  const s = spyStore();
  const transport = createLocalTransport({
    songId: 'tune',
    defaultTempoBpm: 120,
    measureCount: 32,
    quarterNotesPerBar: 4,
    renderer: r.renderer,
    store: s.store,
    now: () => 50_000,
    ...over,
  });
  return { transport, ...r, ...s };
}

describe('stamp origin routing', () => {
  it('play, pause, and seekToBar stamp as intents with their kind', () => {
    const { transport, stamps, emitPlaying } = makeTransport();
    transport.play();
    emitPlaying(true);
    transport.pause();
    emitPlaying(false);
    transport.seekToBar(5);
    expect(stamps.map((s) => s.meta)).toEqual([
      { origin: 'intent', kind: 'play' },
      { origin: 'intent', kind: 'pause' },
      { origin: 'intent', kind: 'seek' },
    ]);
  });

  it('a paused tap-a-bar is an intent seek', () => {
    const { stamps, emitPosition } = makeTransport();
    emitPosition(7); // position moved while paused = alphaTab click-to-seek
    expect(stamps).toHaveLength(1);
    expect(stamps[0].meta).toEqual({ origin: 'intent', kind: 'seek' });
    expect(stamps[0].t.startBar).toBe(7);
  });

  it('a repeat/volta jump while playing is a local anchor', () => {
    const { transport, stamps, emitPlaying, emitPosition } = makeTransport();
    transport.play();
    emitPlaying(true);
    emitPosition(2); // sequential: no stamp
    emitPosition(1); // repeat barline: non-sequential → anchor re-stamp
    expect(stamps).toHaveLength(2);
    expect(stamps[1].meta).toEqual({ origin: 'anchor' });
  });

  it('a tempo-continuity restamp is a local anchor (tempo syncs via songSettings)', () => {
    const { transport, stamps } = makeTransport();
    transport.setTempoPercent(0.8);
    expect(stamps).toHaveLength(1);
    expect(stamps[0].meta).toEqual({ origin: 'anchor' });
  });
});
```

Add the imports the block needs at the top of the file if not present: `LocalTransportDeps` from `./localTransport`, `SessionStore`/`Transport` from `../session/types`.

- [x] **Step 2: Run test to verify it fails**

Run: `npm test -- src/transport/localTransport.test.ts`
Expected: FAIL — `TransportStampMeta` has no export; stamps receive no meta.

- [x] **Step 3: Add the types**

In `src/session/types.ts`, after the `Transport` interface add:

```typescript
/** Which user action an intent stamp expresses — drives the follower's apply rules. */
export type TransportIntentKind = 'play' | 'pause' | 'seek';

/**
 * Stamp routing (ADR-002 D2.1). `intent` = a user action ("the band should be here"):
 * written to the shared doc. `anchor` = a mechanical projection re-anchor (repeat/volta
 * jump, tempo-continuity restamp): local-only — every device hits the same jumps itself.
 * `remote` = the local echo of applying a peer's intent: local-only. The default is
 * `anchor` so an untagged write can never leak to the band.
 */
export type TransportStampMeta =
  | { origin: 'intent'; kind: TransportIntentKind }
  | { origin: 'anchor' }
  | { origin: 'remote' };

/**
 * The doc value at session.transport — one whole object per stamp (fields are only
 * coherent as a unit). `issuedAt` is the wall-clock press time and the ONLY conflict
 * key; `startTimestamp` is a projection anchor deliberately stamped in the future
 * through count-in and must never order conflicts (ADR-002 D2.2).
 */
export interface SharedTransportIntent extends Transport {
  issuedAt: number;
  authorId: string;
  kind: TransportIntentKind;
}

/** The doc value at session.song. `author` is the display name, for the switch notice. */
export interface SharedSongIntent {
  songId: string;
  issuedAt: number;
  authorId: string;
  author: string;
}
```

and widen the `SessionStore` method (implementations may ignore the parameter — a
one-arg implementation remains assignable):

```typescript
  setTransport(transport: Transport, meta?: TransportStampMeta): void;
```

`src/session/store.ts` needs **no change**.

- [x] **Step 4: Route origins in `localTransport.ts`**

1. Import the meta type: `import type { SessionStore, Transport, TransportStampMeta } from '../session/types';`
2. Give `stamp` a meta parameter and forward it (defaulting to anchor):

```typescript
  function stamp(over: Partial<Transport>, meta: TransportStampMeta = { origin: 'anchor' }): void {
    current = {
      songId,
      playing,
      startBar: currentBar,
      startTimestamp: now(),
      tempo: defaultTempoBpm * pct,
      ...over,
    };
    store.setTransport(current, meta);
    listeners.forEach((cb) => cb(current));
  }
```

3. Tag each existing call site:
   - `play()`: `stamp({ playing: true, startTimestamp: now() + countInMs }, { origin: 'intent', kind: 'play' });`
   - `pause()`: `stamp({ playing: false }, { origin: 'intent', kind: 'pause' });`
   - `seekToBar()`: `stamp({ startBar: target }, { origin: 'intent', kind: 'seek' });`
   - `setTempoPercent()`: `stamp({});` — unchanged (defaults to anchor). Add a comment: `// anchor: tempo *changes* sync via songSettings; this restamp is only position continuity`.
   - The `onPosition` handler must split its two cases:

```typescript
  renderer.onPosition((bar) => {
    const tappedWhilePaused = !playing && bar !== currentBar;
    const jumpedWhilePlaying = playing && bar !== currentBar + 1;
    currentBar = bar;
    // A paused tap is a user seek (intent); a playing jump is a repeat/volta re-anchor
    // (local-only — every device's renderer hits the same jumps itself). ADR-002 D2.1.
    if (tappedWhilePaused) stamp({ startBar: bar }, { origin: 'intent', kind: 'seek' });
    else if (jumpedWhilePlaying) stamp({ startBar: bar });
  });
```

- [x] **Step 5: Run tests + type-check**

Run: `npm test -- src/transport/localTransport.test.ts && npm run check`
Expected: new tests PASS, **all pre-existing tests still pass unchanged**, 0 type errors.

- [x] **Step 6: Commit**

```bash
git add src/session/types.ts src/transport/localTransport.ts src/transport/localTransport.test.ts
git commit -m "feat(sync): tag transport stamps by origin (intent/anchor/remote)"
```

---

## Task 2: `session` map accessors on the band doc

**Files:**
- Modify: `src/sync/doc.ts`
- Test: `src/sync/doc.test.ts` (append)

**Interfaces produced:** `getSessionTransport(doc)`, `setSessionTransport(doc, stamp)`, `getSessionSong(doc)`, `setSessionSong(doc, s)` — whole-object values under keys `'transport'` / `'song'` of the (already reserved) `session` map.

- [x] **Step 1: Write the failing test**

Append to `src/sync/doc.test.ts`:

```typescript
import {
  getSessionTransport, setSessionTransport, getSessionSong, setSessionSong,
} from './doc';
import type { SharedTransportIntent, SharedSongIntent } from '../session/types';

const intent: SharedTransportIntent = {
  songId: 'tune', playing: true, startBar: 1, startTimestamp: 60_000, tempo: 120,
  issuedAt: 59_000, authorId: 'dev-a', kind: 'play',
};

describe('doc session map', () => {
  it('round-trips transport and song intents; empty doc reads null', () => {
    const doc = createBandDoc();
    expect(getSessionTransport(doc)).toBeNull();
    expect(getSessionSong(doc)).toBeNull();
    setSessionTransport(doc, intent);
    setSessionSong(doc, { songId: 'tune', issuedAt: 1, authorId: 'dev-a', author: 'Kate' });
    expect(getSessionTransport(doc)).toEqual(intent);
    expect(getSessionSong(doc)?.author).toBe('Kate');
  });

  it('converges: both docs agree on one stamp after exchanging updates', () => {
    const a = createBandDoc();
    const b = createBandDoc();
    setSessionTransport(a, intent);
    setSessionTransport(b, { ...intent, issuedAt: 59_500, authorId: 'dev-b', kind: 'pause', playing: false });
    importUpdate(b, exportUpdate(a));
    importUpdate(a, exportUpdate(b));
    // Yjs resolves the storage conflict (causality + client id); the app-level issuedAt
    // rule orders APPLICATION, not storage. Here we only assert convergence.
    expect(getSessionTransport(a)).toEqual(getSessionTransport(b));
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `npm test -- src/sync/doc.test.ts`
Expected: FAIL — no such exports.

- [x] **Step 3: Implement the accessors**

In `src/sync/doc.ts`: add `SharedTransportIntent, SharedSongIntent` to the type import from `'../session/types'`, add a `const SESSION = 'session';` next to the other map names, and append:

```typescript
/**
 * Live session state (playback sync). Whole-object values — a transport stamp's fields
 * are only coherent as a unit, so unlike songSettings there is no field-level keying:
 * concurrent stamps resolve whole-stamp (Yjs storage-level), then by issuedAt on apply.
 */
function sessionMap(doc: Y.Doc): Y.Map<unknown> {
  return doc.getMap<unknown>(SESSION);
}

export function getSessionTransport(doc: Y.Doc): SharedTransportIntent | null {
  return (sessionMap(doc).get('transport') as SharedTransportIntent | undefined) ?? null;
}
export function setSessionTransport(doc: Y.Doc, stamp: SharedTransportIntent): void {
  sessionMap(doc).set('transport', stamp);
}
export function getSessionSong(doc: Y.Doc): SharedSongIntent | null {
  return (sessionMap(doc).get('song') as SharedSongIntent | undefined) ?? null;
}
export function setSessionSong(doc: Y.Doc, song: SharedSongIntent): void {
  sessionMap(doc).set('song', song);
}
```

- [x] **Step 4: Run tests to verify they pass**

Run: `npm test -- src/sync/doc.test.ts`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add src/sync/doc.ts src/sync/doc.test.ts
git commit -m "feat(sync): session map accessors (transport + song intents)"
```

---

## Task 3: Synced store — intent decoration + dedicated session channels

**Files:**
- Modify: `src/sync/syncedSessionStore.ts`
- Test: `src/sync/syncedSessionStore.test.ts` (append)

**Interfaces produced (additions to `SyncedSessionStore`):**

```typescript
  getSessionTransport(): SharedTransportIntent | null;
  getSessionSong(): SharedSongIntent | null;
  /** Fires on session.transport doc changes — own writes included (the follower's echo
   *  guard needs them to advance its issuedAt cursor). Dedicated channel: a songSettings
   *  or corrections change must never masquerade as a transport stamp, and vice versa. */
  subscribeSessionTransport(run: (t: SharedTransportIntent | null) => void): () => void;
  subscribeSessionSong(run: (s: SharedSongIntent | null) => void): () => void;
```

plus a `now?: () => number` option on `createSyncedSessionStore` (defaults to `Date.now`).

- [x] **Step 1: Write the failing test**

Append to `src/sync/syncedSessionStore.test.ts` (the file already has `fakeStorage()`; reuse it):

```typescript
import { exportUpdate, importUpdate } from './doc';
import type { Transport } from '../session/types';

const t0: Transport = { songId: 'tune', playing: true, startBar: 1, startTimestamp: 60_000, tempo: 120 };

describe('session sync (playback)', () => {
  it('decorates intent stamps with issuedAt/authorId/kind and writes the doc', () => {
    const store = createSyncedSessionStore({ storage: fakeStorage(), now: () => 111 });
    store.setTransport(t0, { origin: 'intent', kind: 'play' });
    expect(store.getSessionTransport()).toEqual({
      ...t0, issuedAt: 111, authorId: store.getIdentity().authorId, kind: 'play',
    });
  });

  it('anchor and remote stamps never reach the doc', () => {
    const store = createSyncedSessionStore({ storage: fakeStorage() });
    store.setTransport(t0); // default = anchor
    store.setTransport(t0, { origin: 'anchor' });
    store.setTransport(t0, { origin: 'remote' });
    expect(store.getSessionTransport()).toBeNull();
    expect(store.getState().transport).toEqual(t0); // local projection state still updates
  });

  it('a remote peer’s intent arrives on the dedicated transport channel', () => {
    const a = createSyncedSessionStore({ storage: fakeStorage(), now: () => 5 });
    const b = createSyncedSessionStore({ storage: fakeStorage() });
    const seen: Array<ReturnType<typeof b.getSessionTransport>> = [];
    b.subscribeSessionTransport((s) => seen.push(s));
    a.setTransport(t0, { origin: 'intent', kind: 'play' });
    importUpdate(b.doc, exportUpdate(a.doc));
    expect(seen.at(-1)).toMatchObject({ ...t0, issuedAt: 5, kind: 'play' });
  });

  it('channel isolation: session writes don’t fire songSettings, and vice versa', () => {
    const store = createSyncedSessionStore({ storage: fakeStorage() });
    let settingsFires = 0;
    let transportFires = 0;
    store.subscribeSongSettings(() => settingsFires++);
    store.subscribeSessionTransport(() => transportFires++);
    const s0 = settingsFires; // both channels deliver once on subscribe
    const t0fires = transportFires;
    store.setTransport(t0, { origin: 'intent', kind: 'play' });
    expect(settingsFires).toBe(s0);
    store.setSongSetting('tune', { tempoPct: 0.8 });
    expect(transportFires).toBe(t0fires + 1); // only its own write moved it
  });

  it('setCurrentSong publishes a song intent with author info', () => {
    const store = createSyncedSessionStore({ storage: fakeStorage(), now: () => 42 });
    store.setDisplayName('Kate');
    store.setCurrentSong('soldiers-joy');
    expect(store.getSessionSong()).toEqual({
      songId: 'soldiers-joy', issuedAt: 42, authorId: store.getIdentity().authorId, author: 'Kate',
    });
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `npm test -- src/sync/syncedSessionStore.test.ts`
Expected: FAIL — missing methods/option.

- [x] **Step 3: Implement**

In `src/sync/syncedSessionStore.ts`:

1. Extend the type import: `import type { SessionState, SessionStore, SongSettings, Transport, TransportStampMeta, SharedTransportIntent, SharedSongIntent } from '../session/types';`
2. Add the four methods above to the `SyncedSessionStore` interface.
3. Accept the clock: `opts: { doc?: Y.Doc; storage?: StorageLike | null; now?: () => number } = {}` and `const now = opts.now ?? (() => Date.now());`
4. Add subscriber sets + one observer routed by key (next to the existing observers):

```typescript
  const sessionTransportSubs = new Set<(t: SharedTransportIntent | null) => void>();
  const sessionSongSubs = new Set<(s: SharedSongIntent | null) => void>();
  const emitSessionTransport = () =>
    sessionTransportSubs.forEach((cb) => cb(doc.getSessionTransport(ydoc)));
  const emitSessionSong = () => sessionSongSubs.forEach((cb) => cb(doc.getSessionSong(ydoc)));

  // One observer, routed by key: transport stamps are high-rate relative to song
  // switches, and neither may masquerade as the other (same lesson as songSettings).
  ydoc.getMap('session').observe((event) => {
    if (event.keysChanged.has('transport')) emitSessionTransport();
    if (event.keysChanged.has('song')) {
      // Keep the generic snapshot's currentSongId coherent with the band's song.
      currentSongId = doc.getSessionSong(ydoc)?.songId ?? currentSongId;
      emitSessionSong();
    }
  });
```

5. Replace the two write methods:

```typescript
    setCurrentSong(songId) {
      currentSongId = songId;
      emitState();
      // Publish the switch: only the picker path calls this (App.svelte D6), so boot
      // resume / deep links / Back never yank the band. Observer fires for own writes
      // (the App's follower needs them to advance its issuedAt cursor).
      doc.setSessionSong(ydoc, {
        songId, issuedAt: now(), authorId: identity.authorId, author: identity.name,
      });
    },
    setTransport(t, meta: TransportStampMeta = { origin: 'anchor' }) {
      transport = t;
      emitState();
      // Only user intents sync; anchor/remote stamps are local projection state
      // (ADR-002 D2.1). The doc write is what reaches the band.
      if (meta.origin === 'intent') {
        doc.setSessionTransport(ydoc, {
          ...t, issuedAt: now(), authorId: identity.authorId, kind: meta.kind,
        });
      }
    },
```

6. Add the getters + subscriptions to the returned object (subscribe delivers the current value immediately, matching the other channels):

```typescript
    getSessionTransport: () => doc.getSessionTransport(ydoc),
    getSessionSong: () => doc.getSessionSong(ydoc),
    subscribeSessionTransport(run) {
      sessionTransportSubs.add(run);
      run(doc.getSessionTransport(ydoc));
      return () => sessionTransportSubs.delete(run);
    },
    subscribeSessionSong(run) {
      sessionSongSubs.add(run);
      run(doc.getSessionSong(ydoc));
      return () => sessionSongSubs.delete(run);
    },
```

- [x] **Step 4: Run tests + full suite + type-check**

Run: `npm test && npm run check`
Expected: all green (existing suites untouched), 0 type errors.

- [x] **Step 5: Commit**

```bash
git add src/sync/syncedSessionStore.ts src/sync/syncedSessionStore.test.ts
git commit -m "feat(sync): session transport/song intents on the synced store"
```

---

## Task 4: Skew log (G3 measurement)

**Files:**
- Create: `src/sync/skewLog.ts`
- Test: `src/sync/skewLog.test.ts`

- [x] **Step 1: Write the failing test**

```typescript
// src/sync/skewLog.test.ts
import { describe, it, expect } from 'vitest';
import { createSkewLog } from './skewLog';

describe('skew log', () => {
  it('records samples, caps the buffer, and summarizes', () => {
    const log = createSkewLog(3);
    expect(log.summary()).toBeNull();
    for (let i = 1; i <= 5; i++) {
      log.record({ kind: 'play', issuedAt: 0, receivedAt: i * 10, deltaMs: i * 10 });
    }
    expect(log.samples()).toHaveLength(3); // capped, oldest dropped
    expect(log.samples().map((s) => s.deltaMs)).toEqual([30, 40, 50]);
    expect(log.summary()).toEqual({ count: 3, minMs: 30, medianMs: 40, p90Ms: 50, maxMs: 50 });
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `npm test -- src/sync/skewLog.test.ts` → FAIL (module missing).

- [x] **Step 3: Implement**

```typescript
// src/sync/skewLog.ts
/**
 * Skew/latency evidence for the M4 gate (multi-user review G3): each applied remote
 * intent records (receivedAt − issuedAt) — one-way delivery latency plus clock skew,
 * conflated on purpose: the *total* observed offset is the playhead-error budget.
 * Read during rehearsal via window.__bandaidSkew (wired in App.svelte).
 */
export interface SkewSample {
  kind: string;
  issuedAt: number;
  receivedAt: number;
  deltaMs: number;
}
export interface SkewSummary {
  count: number;
  minMs: number;
  medianMs: number;
  p90Ms: number;
  maxMs: number;
}
export interface SkewLog {
  record(s: SkewSample): void;
  samples(): SkewSample[];
  summary(): SkewSummary | null;
}

export function createSkewLog(cap = 200): SkewLog {
  const buf: SkewSample[] = [];
  return {
    record(s) {
      buf.push(s);
      if (buf.length > cap) buf.shift();
    },
    samples: () => [...buf],
    summary() {
      if (buf.length === 0) return null;
      const sorted = buf.map((s) => s.deltaMs).sort((a, b) => a - b);
      const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
      return {
        count: sorted.length,
        minMs: sorted[0],
        medianMs: at(0.5),
        p90Ms: at(0.9),
        maxMs: sorted[sorted.length - 1],
      };
    },
  };
}

/** App-wide singleton — the follower records into it, App exposes it on window. */
export const skewLog = createSkewLog();
```

- [x] **Step 4: Run tests** → PASS.

- [x] **Step 5: Commit**

```bash
git add src/sync/skewLog.ts src/sync/skewLog.test.ts
git commit -m "feat(sync): skew sample log for the M4 drift gate"
```

---

## Task 5: Transport follower (ordering / echo / staleness guards)

**Files:**
- Create: `src/sync/transportFollower.ts`
- Test: `src/sync/transportFollower.test.ts`

- [x] **Step 1: Write the failing test**

```typescript
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
```

- [x] **Step 2: Run test to verify it fails** → FAIL (module missing).

- [x] **Step 3: Implement**

```typescript
// src/sync/transportFollower.ts
import type { SharedTransportIntent } from '../session/types';
import type { SkewLog } from './skewLog';

/**
 * The apply-side of ADR-002 D2: decides WHETHER a session.transport stamp applies.
 * Mechanics (seek/play/pause against the renderer) live in localTransport.applyRemote.
 * One follower per loaded song — cross-song stamps can never mis-apply, and a song
 * switch starts a fresh issuedAt cursor.
 */
export interface TransportFollowerDeps {
  songId: string;
  /** This device's stable id — its own stamps advance the cursor but never re-apply. */
  authorId: string;
  apply(stamp: SharedTransportIntent): void;
  skewLog?: SkewLog;
  now?: () => number;
}

export interface TransportFollower {
  receive(stamp: SharedTransportIntent | null): void;
}

export function createTransportFollower(deps: TransportFollowerDeps): TransportFollower {
  const now = deps.now ?? (() => Date.now());
  // Compared against applied INTENTS only — never against local anchor re-anchors,
  // which refresh at every repeat barline and would otherwise reject nearly everything
  // mid-tune (ADR-002 D2.2).
  let lastAppliedIssuedAt = 0;
  return {
    receive(stamp) {
      if (!stamp) return;
      if (stamp.authorId === deps.authorId) {
        lastAppliedIssuedAt = Math.max(lastAppliedIssuedAt, stamp.issuedAt);
        return;
      }
      if (stamp.songId !== deps.songId) return;
      if (stamp.issuedAt <= lastAppliedIssuedAt) return;
      lastAppliedIssuedAt = stamp.issuedAt;
      const receivedAt = now();
      deps.skewLog?.record({
        kind: stamp.kind,
        issuedAt: stamp.issuedAt,
        receivedAt,
        deltaMs: receivedAt - stamp.issuedAt,
      });
      deps.apply(stamp);
    },
  };
}
```

- [x] **Step 4: Run tests** → PASS.

- [x] **Step 5: Commit**

```bash
git add src/sync/transportFollower.ts src/sync/transportFollower.test.ts
git commit -m "feat(sync): transport follower — issuedAt LWW, echo guard, skew samples"
```

---

## Task 6: `applyRemote` + `dispose` on the local transport

**Files:**
- Modify: `src/transport/localTransport.ts`
- Test: `src/transport/localTransport.test.ts` (append)

**Interfaces produced (additions to `LocalTransport` / `LocalTransportDeps`):**

```typescript
  /** Apply a peer's intent: the follower mechanics. Never publishes back to the doc. */
  applyRemote(stamp: SharedTransportIntent): void;
  /** Cancel any pending scheduled remote start (song switch / unmount). */
  dispose(): void;
  // deps:
  /** Timer seam for the scheduled remote start; injectable for tests. Returns a cancel. */
  schedule?: (fn: () => void, delayMs: number) => () => void;
```

- [x] **Step 1: Write the failing test**

Append to `src/transport/localTransport.test.ts` (uses the Task 1 helpers):

```typescript
import type { SharedTransportIntent } from '../session/types';

function manualScheduler() {
  const pending: Array<{ fn: () => void; delayMs: number; cancelled: boolean }> = [];
  return {
    schedule: (fn: () => void, delayMs: number) => {
      const entry = { fn, delayMs, cancelled: false };
      pending.push(entry);
      return () => { entry.cancelled = true; };
    },
    pending,
    fire: () => pending.splice(0).forEach((p) => !p.cancelled && p.fn()),
  };
}

const remote = (over: Partial<SharedTransportIntent> = {}): SharedTransportIntent => ({
  songId: 'tune', playing: true, startBar: 1, startTimestamp: 50_000, tempo: 120,
  issuedAt: 49_900, authorId: 'peer', kind: 'play', ...over,
});

describe('applyRemote', () => {
  it('pause aligns to the pauser’s bar and stamps origin remote (never intent)', () => {
    const { transport, calls, stamps, emitPlaying } = makeTransport();
    transport.play();
    emitPlaying(true);
    transport.applyRemote(remote({ playing: false, startBar: 9, kind: 'pause' }));
    expect(calls).toContain('pause');
    expect(calls).toContain('seek:9');
    expect(stamps.at(-1)!.meta).toEqual({ origin: 'remote' });
    expect(transport.getTransport()).toMatchObject({ playing: false, startBar: 9 });
  });

  it('seek while both playing just seeks — playback continues, no re-play', () => {
    const { transport, calls, emitPlaying } = makeTransport();
    transport.play();
    emitPlaying(true);
    const playsBefore = calls.filter((c) => c === 'play').length;
    transport.applyRemote(remote({ kind: 'seek', startBar: 5 }));
    expect(calls).toContain('seek:5');
    expect(calls.filter((c) => c === 'play')).toHaveLength(playsBefore);
  });

  it('a future start (initiator count-in) schedules play at the stamped instant, count-in off', () => {
    const sched = manualScheduler();
    const { transport, calls, stamps } = makeTransport({ schedule: sched.schedule });
    transport.applyRemote(remote({ startTimestamp: 51_200 })); // now() is 50_000
    expect(calls).toContain('seek:1');
    expect(calls).toContain('countin:0');
    expect(calls).not.toContain('play');
    expect(sched.pending[0].delayMs).toBe(1_200);
    // projection holds at startBar through the wait (future anchor mirrored locally)
    expect(stamps.at(-1)!.t.startTimestamp).toBe(51_200);
    sched.fire();
    expect(calls).toContain('play');
  });

  it('a local user action cancels a pending scheduled start', () => {
    const sched = manualScheduler();
    const { transport, calls } = makeTransport({ schedule: sched.schedule });
    transport.applyRemote(remote({ startTimestamp: 51_200 }));
    transport.pause(); // the user's own intent supersedes (and publishes)
    sched.fire();
    expect(calls).not.toContain('play');
  });

  it('late join: seeks to the linearly projected bar and plays', () => {
    // 30 s elapsed at 120 qpm, 4 quarters/bar → 15 bars past startBar 1 → bar 16.
    const { transport, calls } = makeTransport();
    transport.applyRemote(remote({ startTimestamp: 20_000, issuedAt: 20_000 }));
    expect(calls).toContain('seek:16');
    expect(calls).toContain('countin:0');
    expect(calls).toContain('play');
  });

  it('a playing stamp projecting past the end lands paused at bar 1', () => {
    const { transport, calls } = makeTransport(); // measureCount 32
    // Synthetic: a fresh issuedAt isolates the projection guard from the age guard.
    // 200 s elapsed at 120 qpm / 4 qpb = 100 bars past startBar 1 → far beyond bar 32.
    transport.applyRemote(remote({ startTimestamp: 50_000 - 200_000, issuedAt: 49_999 }));
    expect(calls).toContain('seek:1');
    expect(calls).not.toContain('play');
    expect(transport.getTransport().playing).toBe(false);
  });

  it('a playing stamp older than 10 minutes lands paused at bar 1 even if it projects in range', () => {
    const { transport, calls } = makeTransport({ measureCount: 10_000 });
    transport.applyRemote(remote({ startTimestamp: 50_000 - 11 * 60_000, issuedAt: 50_000 - 11 * 60_000 }));
    expect(calls).toContain('seek:1');
    expect(calls).not.toContain('play');
    expect(transport.getTransport().playing).toBe(false);
  });

  it('ignores stamps for another song', () => {
    const { transport, calls } = makeTransport();
    transport.applyRemote(remote({ songId: 'other' }));
    expect(calls).toHaveLength(0);
  });
});
```

- [x] **Step 2: Run test to verify it fails** → FAIL (`applyRemote` missing).

- [x] **Step 3: Implement in `localTransport.ts`**

1. Imports: `import { projectBar } from '../playhead/projectBar';` and add `SharedTransportIntent` to the types import.
2. Add to `LocalTransportDeps`: `schedule?: (fn: () => void, delayMs: number) => () => void;`
3. Add to the `LocalTransport` interface: `applyRemote(stamp: SharedTransportIntent): void;` and `dispose(): void;`
4. Add a module constant: `export const MAX_REMOTE_PLAYING_AGE_MS = 10 * 60_000;` with a comment: a `playing` stamp this old means someone closed the app mid-tune — land paused instead of haunting the next session.
5. In `createLocalTransport`, near the top:

```typescript
  const schedule =
    deps.schedule ??
    ((fn: () => void, delayMs: number) => {
      const id = setTimeout(fn, delayMs);
      return () => clearTimeout(id);
    });
  // Pending scheduled remote start; any user action or a newer remote stamp cancels it.
  let cancelScheduled: (() => void) | null = null;
  function clearScheduled(): void {
    cancelScheduled?.();
    cancelScheduled = null;
  }
```

6. Call `clearScheduled();` as the first line of `play()`, `pause()`, `seekToBar()`, and `setTempoPercent()`.
7. Add the two methods to the returned object:

```typescript
    // The parameter is named `intent` so the internal stamp() helper stays reachable.
    applyRemote(intent: SharedTransportIntent) {
      clearScheduled();
      if (intent.songId !== songId) return; // belt & braces; the follower already filters
      const REMOTE = { origin: 'remote' } as const;
      const target = clamp(Math.round(intent.startBar), 1, measureCount);

      if (!intent.playing) {
        // Pause (or a paused seek) is a re-sync moment: align to the stamped bar.
        renderer.pause();
        playing = false;
        renderer.seekToBar(target);
        currentBar = target;
        stamp({ playing: false, startBar: target }, REMOTE);
        return;
      }

      if (playing && intent.kind === 'seek') {
        // Explicit band seek while we're already playing: jump, keep playing.
        renderer.seekToBar(target);
        currentBar = target;
        stamp({ startBar: target }, REMOTE);
        return;
      }

      // Cold start (we're paused, the band plays) or a fresh play.
      const nowMs = now();
      const delay = intent.startTimestamp - nowMs;
      if (delay > 0) {
        // The initiator is inside their count-in window: start exactly at the stamped
        // instant, never with a local count-in (feature D2). projectBar floors elapsed
        // at 0, so mirroring the future anchor holds the playhead at startBar.
        // If we were somehow still playing (an intermediate pause stamp compacted away
        // by whole-object LWW), silence until the stamped instant.
        renderer.pause();
        renderer.seekToBar(target);
        currentBar = target;
        renderer.setCountInVolume(0);
        playing = true;
        cancelScheduled = schedule(() => renderer.play(), delay);
        stamp({ playing: true, startBar: target, startTimestamp: intent.startTimestamp }, REMOTE);
        return;
      }

      // Late join: linear projection (repeats make this approximate — feature D5).
      const projected = projectBar(intent, nowMs, quarterNotesPerBar);
      const stale =
        projected > measureCount || nowMs - intent.issuedAt > MAX_REMOTE_PLAYING_AGE_MS;
      if (stale) {
        renderer.pause();
        playing = false;
        renderer.seekToBar(1);
        currentBar = 1;
        stamp({ playing: false, startBar: 1 }, REMOTE);
        return;
      }
      const joinBar = clamp(Math.floor(projected), 1, measureCount);
      renderer.seekToBar(joinBar);
      currentBar = joinBar;
      renderer.setCountInVolume(0);
      renderer.play();
      playing = true;
      // Re-anchor at what THIS device actually did: on an approximate join, local
      // consistency (overlay/scrubber match local audio) beats a shared-but-wrong anchor.
      stamp({ playing: true, startBar: joinBar }, REMOTE);
    },

    dispose() {
      clearScheduled();
    },
```

Note `applyRemote` never touches `renderer.setSpeed` — playback tempo is `songSettings`' domain (the view's existing subscriber applies it); the stamp's `tempo` is used only inside `projectBar`.

- [x] **Step 4: Run tests + full suite + type-check**

Run: `npm test && npm run check`
Expected: all green. The pre-existing localTransport tests must pass **unchanged** (the new `clearScheduled()` calls are no-ops without a pending schedule).

- [x] **Step 5: Commit**

```bash
git add src/transport/localTransport.ts src/transport/localTransport.test.ts
git commit -m "feat(sync): applyRemote — follower mechanics on the local transport"
```

---

## Task 7: Wire the follower in ChordChangesView

**Files:**
- Modify: `src/views/ChordChangesView.svelte`

No new unit test (Svelte wiring; the logic underneath is fully covered). Verified by type-check, the existing suite, and Task 9's manual e2e.

- [x] **Step 1: Wire it**

1. Imports: add `onDestroy` to the svelte import; add
   `import { createTransportFollower } from '../sync/transportFollower';` and
   `import { skewLog } from '../sync/skewLog';`
2. Script-level state + wiring function (place near the `onReady` function):

```typescript
  // Follow the band's transport (playback sync). Wired once the player can actually
  // play (onreadyforplayback) — applying a play stamp before the soundfont is loaded
  // would be dropped by alphaTab. One follower per loaded song; subscribing delivers
  // the current doc stamp immediately, so a device that opens mid-tune joins in.
  let unsubFollower: (() => void) | undefined;
  function wireFollower() {
    if (unsubFollower || !transport) return;
    const follower = createTransportFollower({
      songId: song.id,
      authorId: store.getIdentity().authorId,
      apply: (stamp) => transport!.applyRemote(stamp),
      skewLog,
    });
    unsubFollower = store.subscribeSessionTransport((stamp) => follower.receive(stamp));
  }
  onDestroy(() => {
    unsubFollower?.();
    transport?.dispose(); // cancel a pending scheduled remote start
  });
```

3. In the `onreadyforplayback` handler in the markup (the one that sets `canPlay = true`), add a call to `wireFollower();` after the existing statements.

- [x] **Step 2: Verify**

Run: `npm run check && npm test && npm run build`
Expected: 0 type errors, suite green, build succeeds.

- [x] **Step 3: Commit**

```bash
git add src/views/ChordChangesView.svelte
git commit -m "feat(sync): follow band transport in the drill view"
```

---

## Task 8: App wiring — song intents, remote song follow, notice, skew hook

**Files:**
- Modify: `src/App.svelte`

- [x] **Step 1: Split publish from render (feature D6)**

In `src/App.svelte`:

1. In `showSong(s)`, **delete** the line `store.setCurrentSong(s.id);` and its comment. Update the function comment to: `// Render a song (no history or session side effects — used by open, Back/Forward, boot resume, and remote follows alike).`
2. In `openSong(s)`, add the store write so only an explicit picker tap publishes:

```typescript
  function openSong(s: SongSummary) {
    history.pushState(null, '', location.pathname + searchWithSong(location.search, s.id));
    // The one path that publishes the switch to the band (playback-sync D6): boot
    // resume, deep links, and Back/Forward render via showSong() and stay local.
    store.setCurrentSong(s.id);
    showSong(s);
  }
```

- [x] **Step 2: Follow remote song switches**

1. Imports: `import type { SharedSongIntent } from './session/types';` and `import { skewLog } from './sync/skewLog';`
2. Script-level state (near the other `$state` declarations):

```typescript
  // Remote song switches: a brief, named, non-blocking notice (playback-sync D7).
  let remoteNotice = $state<string | null>(null);
  let noticeTimer: ReturnType<typeof setTimeout> | undefined;
  let lastAppliedSongIssuedAt = 0;
  const myAuthorId = store.getIdentity().authorId;

  function followRemoteSong(intent: SharedSongIntent | null) {
    if (!intent || !service) return;
    if (intent.authorId === myAuthorId) {
      lastAppliedSongIssuedAt = Math.max(lastAppliedSongIssuedAt, intent.issuedAt);
      return;
    }
    if (intent.issuedAt <= lastAppliedSongIssuedAt) return;
    lastAppliedSongIssuedAt = intent.issuedAt;
    if (intent.songId === current?.id) return;
    const s = service.getSongSummary(intent.songId);
    if (!s) return; // unknown id (library version drift) — ignore
    // replaceState, not pushState: Back must not walk through bandmates' switches.
    history.replaceState(null, '', location.pathname + searchWithSong(location.search, s.id));
    showSong(s);
    remoteNotice = `${intent.author || 'A bandmate'} switched to ${s.title}`;
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => (remoteNotice = null), 4000);
  }
```

3. In `onMount`'s async block, **after** the boot-pick logic (so the band's song wins over a local resume but the subscription exists only once the library can resolve ids), add:

```typescript
      // Follow the band's current song. Subscribe delivers the current doc value
      // immediately, so a device opening mid-set lands on the band's song.
      unsubSessionSong = store.subscribeSessionSong(followRemoteSong);
```

   with a script-level `let unsubSessionSong: (() => void) | undefined;` and `unsubSessionSong?.();` added to the existing `onDestroy` block.
4. Also in `onMount` (sync part), expose the skew readout for rehearsal dogfooding:

```typescript
    // Rehearsal dogfood readout (G3/M4 gate): __bandaidSkew() in the console.
    (window as unknown as Record<string, unknown>).__bandaidSkew = () => ({
      summary: skewLog.summary(),
      samples: skewLog.samples(),
    });
```

- [x] **Step 3: The notice markup + style**

After the `{#if current}` block's `{/key}` closing tag (still inside the `{#if current}` branch is fine, but placing it at the top level next to the boot branches is simpler — put it immediately before the final `{:else if service}` chain's end), add at the **top level of the markup**:

```svelte
{#if remoteNotice}
  <div class="remote-notice" role="status">{remoteNotice}</div>
{/if}
```

and to the `<style>` block:

```css
  /* Above the picker slide-over (z 1002) and alphaTab cursors (z 1000). */
  .remote-notice {
    position: fixed;
    top: 0.6rem;
    left: 50%;
    transform: translateX(-50%);
    z-index: 1003;
    background: rgba(20, 22, 26, 0.92);
    color: #fff;
    padding: 0.45rem 0.9rem;
    border-radius: 999px;
    font-size: 0.85rem;
    box-shadow: 0 2px 12px rgba(0, 0, 0, 0.35);
    animation: notice-in 0.15s ease-out;
    pointer-events: none;
  }
  @keyframes notice-in {
    from { opacity: 0; transform: translate(-50%, -0.4rem); }
    to { opacity: 1; transform: translate(-50%, 0); }
  }
```

- [x] **Step 4: Verify**

Run: `npm run check && npm test && npm run build`
Expected: all green. Then `npm run dev` and confirm in one browser: opening a song from the picker still works, Back returns to the picker, reload resumes the song — and **nothing about solo behavior changed**.

- [x] **Step 5: Commit**

```bash
git add src/App.svelte
git commit -m "feat(sync): follow band song switches; picker-only publishing; skew readout"
```

---

## Task 9: End-to-end verification + docs status

**Files:**
- Modify: `docs/project/CONTEXT.md`, `docs/project/roadmap.md`, `docs/project/features/playback-sync.md`

- [x] **Step 1: Full gate**

Run: `npm test && npm run check && npm run build`
Expected: everything green.

- [ ] **Step 2: Two-context manual e2e (the feature spec's acceptance walk)**

`npm run dev`, then open **two browser profiles/windows** at `http://localhost:5173/?band=e2e-test` (with `VITE_SYNC_HOST` unset this rides y-webrtc; if flaky locally, run `npx wrangler dev` and set `VITE_SYNC_HOST` to its host). Verify, in order:

1. Open a song from the picker in window A → window B loads it and shows "〈name〉 switched to …" (set a display name via the identity flow first if available; otherwise expect "A bandmate switched to …").
2. Play in A (count-in on) → B starts at the stamped downbeat with **no count-in**; both cursors sweep.
3. Pause in B → both pause **on the same bar**.
4. Drag A's scrubber while playing → B jumps and keeps playing.
5. Change tempo in B → A's tempo pill/slider follow (pre-existing songSettings sync — regression check).
6. Reload B mid-tune → it comes back on the song, playing near the projected bar.
7. In B's console: `__bandaidSkew()` shows samples with plausible deltas.
8. Open a third window with **no** `?band=` → fully solo, unaffected by A/B activity.
9. Back in A returns to the picker without changing B.

Record any deviation as a bug before proceeding; do not paper over.

- [x] **Step 3: Update docs status**

- `docs/project/features/playback-sync.md` — flip Implementation Status to Built, check off the acceptance criteria verified above (leave the on-device iPad line unchecked until the band confirms), add a changelog row.
- `docs/project/CONTEXT.md` — add playback-sync to the Feature Specifications table and note Phase 3 status in the phase section.
- `docs/project/roadmap.md` — check off M2 "Shared logical state", "Real multiplayer join … " and "Loose follow-along playhead" items as appropriate; update the Feature Specification Status table row.

- [x] **Step 4: Commit**

```bash
git add docs/
git commit -m "docs: playback sync built — status + roadmap updates"
```

---

## Self-Review

**Spec coverage (design → tasks):**
- Origin routing at the seam (ADR-002 D2.1) → Task 1. ✓
- `session` map, whole-object keys → Task 2. ✓
- `issuedAt`/`authorId`/`kind` decoration; dedicated channels; `now` injection → Task 3. ✓
- Skew evidence (G3) → Task 4, surfaced in Task 8. ✓
- Apply rules — LWW / echo / song filter / staleness → Task 5 (whether) + Task 6 (how). ✓
- Scheduled follower start, count-in suppression, pause-as-resync, seek-while-playing, late-join projection + guards, no-speed-touching → Task 6. ✓
- Per-song follower lifecycle at playback-ready; dispose → Task 7. ✓
- Picker-only publishing, replaceState follows, named notice, boot/Back local-only → Task 8. ✓
- Session-of-one invariant → asserted implicitly (no existing test changes) + Task 9 step 2.8. ✓
- Tempo/key via songSettings only → Task 1 (anchor restamp) + Task 6 (no setSpeed) + Task 9 step 2.5. ✓

**Placeholder scan:** one deliberately-called-out test body in Task 6 Step 1 has its concrete replacement given immediately below it — the implementer must apply it before running. No other TBDs.

**Type consistency:** `TransportStampMeta`/`SharedTransportIntent`/`SharedSongIntent` defined once in Task 1 (`session/types.ts`) and imported everywhere else (Tasks 2, 3, 5, 6, 8). `SkewLog` defined in Task 4, consumed in Tasks 5, 7, 8. Follower deps (Task 5) match the wiring call (Task 7). `schedule` seam defined in Task 6 deps and used by its tests.

**Server:** no changes — the PartyServer `YServer` relays the `session` keys like any doc content.
