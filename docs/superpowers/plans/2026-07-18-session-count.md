# Session Player Count Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Session chip shows how many devices are in the live session — **Joined · 2** when the session has company, plain **Joined** when you're alone in it — so a player knows whether "we're in a session together" without any presence roster.

**Architecture:** One shared Yjs `Awareness` instance (from `y-protocols/awareness`, already installed as a dependency of y-webrtc/y-partyserver) rides the existing providers — both `WebrtcProvider` and y-partyserver's `YProvider` accept an `awareness` option and propagate it over every transport tier (WebRTC, BroadcastChannel, relay). `bandSession` sets a `session: { joined }` awareness field on join/leave and derives `sessionCount` = number of devices whose field says joined (self included). Awareness state is ephemeral by design — a device that disconnects is dropped automatically, so no CRDT garbage and no stale counts beyond the protocol's ~30s outage timeout.

**Tech Stack:** Svelte 5, TypeScript, Yjs awareness protocol (`y-protocols/awareness`), Vitest.

## Global Constraints

- **Scope guard (David's design):** count only — no names, no roster UI, no "who". Explicitly out of scope: showing session activity to a *non-joined* device (chip stays "Join" regardless of others), device display names.
- Branch `feat/session-count`, based on `feat/band-book-sync-split`; PR base = `feat/band-book-sync-split` (GitHub retargets to `main` automatically when #59 merges). Merge order: after #59.
- Chip copy exactly: `Join` (off) / `Joined` (on, count ≤ 1) / `Joined · N` (on, count ≥ 2). The Band Book badge is untouched — session info must not blur into the network badge.
- The count includes this device (two-member band reads "Joined · 2", matching how a band counts itself).
- No new package.json dependencies: `y-protocols` is imported directly (guaranteed present — it is a hard dependency of both y-webrtc and y-partyserver and ships the `Awareness` class both accept).
- Standing rules: PR into main-stack, no VERSION/CHANGELOG files, `npm test` + `npm run check` green, remix:check untouched.
- Dev-PC verification: two browser tabs (BroadcastChannel tier carries awareness).

---

### Task 1: Awareness plumbing through the provider layer

**Files:**
- Modify: `src/sync/providers/types.ts` (ProviderFactory signature)
- Modify: `src/sync/providers/attach.ts` (pass-through)
- Modify: `src/sync/providers/webrtc.ts`, `src/sync/providers/partyserver.ts` (forward to constructors)
- Test: `src/sync/providers/attach.test.ts`, `src/sync/providers/webrtc.test.ts` (additions)

**Interfaces:**
- Produces: `ProviderFactory = (doc, bandCode, awareness?) => SyncProvider` where `awareness?: Awareness` (type-only import from `y-protocols/awareness`); `attachProviders(doc, bandCode, factories, awareness?)` forwards it. Task 2's `bandSession` calls `attachProviders(..., awareness)`.

- [ ] **Step 1: Create the branch**

```bash
git checkout feat/band-book-sync-split && git checkout -b feat/session-count
```

- [ ] **Step 2: Write the failing tests**

In `src/sync/providers/attach.test.ts`, add inside the existing describe (reusing its imports):

```ts
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
```

In `src/sync/providers/webrtc.test.ts`, extend the y-webrtc mock to capture constructor options, and add a test. Replace the mock block with:

```ts
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
```

And the test:

```ts
it('hands the shared awareness to the underlying WebrtcProvider', () => {
  const fakeAwareness = { the: 'awareness' } as never;
  webrtcProvider(new Y.Doc(), 'test-band', fakeAwareness);
  expect(lastOptions?.awareness).toBe(fakeAwareness);
});
```

- [ ] **Step 3: Run to verify failure**

Run: `npx vitest run src/sync/providers`
Expected: FAIL — factory third argument is undefined / options lack awareness (TS may also error on arity — that counts).

- [ ] **Step 4: Implement**

`src/sync/providers/types.ts` — extend the factory signature:

```ts
import type * as Y from 'yjs';
import type { Awareness } from 'y-protocols/awareness';
```

and change the last line to:

```ts
/** The optional shared Awareness instance carries ephemeral per-device state (e.g. the
 *  session-joined flag) over the same transports as the doc. Providers with no concept
 *  of it (indexeddb) simply ignore the argument. */
export type ProviderFactory = (doc: Y.Doc, bandCode: string, awareness?: Awareness) => SyncProvider;
```

`src/sync/providers/attach.ts` — accept and forward (signature + the one call site):

```ts
export function attachProviders(
  doc: Y.Doc,
  bandCode: string,
  factories: ProviderFactory[],
  awareness?: Awareness,
): AttachedSync {
```

(with `import type { Awareness } from 'y-protocols/awareness';` added) and inside the loop:

```ts
      p = make(doc, bandCode, awareness);
```

`src/sync/providers/webrtc.ts` — accept and forward:

```ts
export const webrtcProvider: ProviderFactory = (doc, bandCode, awareness) => {
  const p = new WebrtcProvider(`bandaid-${bandCode}`, doc, awareness ? { awareness } : undefined);
```

`src/sync/providers/partyserver.ts` — accept and forward:

```ts
export function partyserverProvider(host: string): ProviderFactory {
  return (doc, bandCode, awareness) => {
    // `party` must match the Durable Object binding name, kebab-cased
    // (binding `Corrections` → party `corrections`, Task 7).
    const p = new YProvider(host, bandCode, doc, { party: 'corrections', ...(awareness ? { awareness } : {}) });
```

- [ ] **Step 5: Run to verify pass**

Run: `npx vitest run src/sync/providers && npm run check`
Expected: PASS; svelte-check clean.

- [ ] **Step 6: Commit**

```bash
git add src/sync/providers
git commit -m "feat(sync): thread a shared awareness instance through the providers"
```

### Task 2: sessionCount in bandSession (TDD)

**Files:**
- Modify: `src/sync/bandSession.ts`
- Test: `src/sync/bandSession.test.ts` (additions)

**Interfaces:**
- Consumes: `attachProviders(doc, code, factories, awareness?)` (Task 1).
- Produces: `createBandSession` gains `awareness?: AwarenessLike`; `BandSessionState` gains `sessionCount: number`. `AwarenessLike` (exported from bandSession.ts) is the narrow structural interface below — the real `Awareness` satisfies it, tests fake it.

```ts
export interface AwarenessLike {
  setLocalStateField(field: string, value: unknown): void;
  getStates(): Map<number, Record<string, unknown> | null>;
  on(event: 'change', cb: () => void): void;
  off(event: 'change', cb: () => void): void;
}
```

- [ ] **Step 1: Write the failing tests**

In `src/sync/bandSession.test.ts` add a fake + tests (and extend `setup` with an `awareness` passthrough):

```ts
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
```

`setup` gains the parameter and passes it through:

```ts
function setup(seed: Record<string, string> = {}, autoAttach = false, awareness?: ReturnType<typeof fakeAwareness>) {
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
```

New describe block:

```ts
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
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/sync/bandSession.test.ts`
Expected: FAIL — `sessionCount` undefined, awareness option unknown.

- [ ] **Step 3: Implement**

In `src/sync/bandSession.ts`:

Add the interface + option and state changes:

```ts
/** The narrow slice of y-protocols' Awareness that bandSession uses — the real class
 *  satisfies it structurally; tests fake it. */
export interface AwarenessLike {
  setLocalStateField(field: string, value: unknown): void;
  getStates(): Map<number, Record<string, unknown> | null>;
  on(event: 'change', cb: () => void): void;
  off(event: 'change', cb: () => void): void;
}
```

`BandSessionState` becomes:

```ts
export interface BandSessionState {
  on: boolean;
  status: SyncStatus;
  /** Devices currently joined to the live session (this one included when joined). */
  sessionCount: number;
}
```

`createBandSession` opts gain `awareness?: AwarenessLike;`. Inside:

```ts
  const awareness = opts.awareness;
  // Ephemeral by design: awareness states vanish with the device, so the count can
  // never go stale the way doc data could. No awareness (tests, degraded boot) →
  // fall back to counting just this device.
  const sessionCount = (): number => {
    if (!awareness) return on ? 1 : 0;
    let n = 0;
    for (const s of awareness.getStates().values()) {
      if ((s as { session?: { joined?: boolean } } | null)?.session?.joined) n++;
    }
    return n;
  };

  const getState = (): BandSessionState => ({
    on,
    status: attached?.getStatus() ?? { providers: {} },
    sessionCount: sessionCount(),
  });
```

In `setOn`, after `writeItem(...)`:

```ts
    awareness?.setLocalStateField('session', { joined: next });
```

In `ensureAttached`, forward it:

```ts
    attached = attachProviders(opts.doc, room, opts.factories, awareness as never);
```

(cast: `AwarenessLike` is the narrow structural view; the App passes a real `Awareness`. Alternatively type opts as `Awareness | AwarenessLike` — use the cast, one line, with this comment.)

After the creation-time attach/resume block (the `if (readItem(...) === '1') on = true;` line), add:

```ts
  // Publish the initial joined flag (covers a resumed session), and re-emit whenever
  // any device's awareness changes — that's what moves the session count.
  awareness?.setLocalStateField('session', { joined: on });
  const onAwareness = () => channel.emit();
  awareness?.on('change', onAwareness);
```

And in the returned `destroy`:

```ts
    destroy: () => {
      awareness?.off('change', onAwareness);
      disconnect();
    },
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/sync/bandSession.test.ts && npm test`
Expected: all pass (the pre-existing bandSession tests keep passing — no awareness passed means self-derived counts).

- [ ] **Step 5: Commit**

```bash
git add src/sync/bandSession.ts src/sync/bandSession.test.ts
git commit -m "feat(sync): session player count via awareness"
```

### Task 3: App wiring + chip copy + verification + PR

**Files:**
- Modify: `src/App.svelte` (create Awareness, pass through, destroy)
- Modify: `src/views/ChordChangesView.svelte` (sync prop type + chip text)

**Interfaces:**
- Consumes: `createBandSession({ ..., awareness })` (Task 2), `BandSessionState.sessionCount`.
- Produces: `sync` prop gains `sessionCount: number`.

- [ ] **Step 1: App.svelte wiring**

Add the import:

```ts
import { Awareness } from 'y-protocols/awareness';
```

Create it right after `const ydoc = createBandDoc();`:

```ts
  // Ephemeral per-device state (the session-joined flag) — rides the same providers
  // as the doc but expires with the device, so counts can't go stale.
  const awareness = new Awareness(ydoc);
```

Pass it to the band session (add to the existing options object):

```ts
  const band = createBandSession({
    doc: ydoc,
    room: bandRoomCode(initialBandName),
    factories: [webrtcProvider, ...(host ? [partyserverProvider(host)] : [])],
    autoAttach: hasSavedBandName(),
    awareness,
  });
```

In `onDestroy`, after `band.destroy();` add:

```ts
    awareness.destroy();
```

In the `<ChordChangesView ... sync={{...}}>` prop, add `sessionCount: bandState.sessionCount`:

```svelte
      sync={{ on: bandState.on, sessionCount: bandState.sessionCount, bandName, summary: syncSummary, toggle: toggleSync, setBandName }}
```

- [ ] **Step 2: ChordChangesView.svelte — prop type + chip**

In the `sync` prop type, add one line after `on: boolean;`:

```ts
      sessionCount: number; // devices in the live session (self included when joined)
```

Change the Session chip's text expression to:

```svelte
        >{sync.on ? (sync.sessionCount > 1 ? `Joined · ${sync.sessionCount}` : 'Joined') : 'Join'}</button>
```

- [ ] **Step 3: Suite + typecheck**

Run: `npm test && npm run check`
Expected: green, 0 errors. (svelte-check catches any missed `sessionCount` in the prop contract.)

- [ ] **Step 4: Two-tab browser verification**

Dev server on this branch; two tabs at `http://localhost:5173`, same band name:

1. Both un-joined: chips read **Join**; badge **Synced** (Band Book, unchanged by this PR).
2. Join in tab A only: A reads **Joined** (no suffix — alone in the session), B still **Join**.
3. Join in tab B too: both flip to **Joined · 2** (this is the "we're in a session together" state).
4. Leave in tab B: A drops back to **Joined** (within a beat), B reads **Join**.
5. Close tab B entirely while both joined, wait ~30s: A drops to **Joined** (awareness expiry — the count self-heals when a device vanishes without leaving).
6. Console: no errors.

- [ ] **Step 5: Commit, push, open the stacked PR**

```bash
git add src/App.svelte src/views/ChordChangesView.svelte docs/superpowers/plans/2026-07-18-session-count.md
git commit -m "feat(session): Joined · N chip — how many devices are in the live session"
git push -u origin feat/session-count
gh pr create --base feat/band-book-sync-split --title "feat: session player count on the Session chip (Joined · N)" --body "Follow-up to #59, from David's dev-testing question: after the sync split there was no way to know anyone ELSE is in the live session — the badge is Band Book network, the chip was only your own state.

- One shared Yjs awareness instance rides the existing providers (both accept it; ephemeral by design, so counts self-heal when a device vanishes)
- \`bandSession\` publishes \`session: { joined }\` on join/leave and derives \`sessionCount\`
- The Session chip reads **Join** / **Joined** / **Joined · N** (N ≥ 2, self included) — deliberately count-only: no names, no roster (David's scope call)
- Band Book badge untouched

**Verification:** unit tests for the awareness plumbing, count derivation, and emit-on-change; two-tab walkthrough (Join in one → \`Joined\`, both → \`Joined · 2\`, leave/close → count drops).

**Stacked on #59** — base is \`feat/band-book-sync-split\`; GitHub retargets to main when it merges.

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

---

## Self-review notes

- **Requirement coverage:** count-visible-when-shared → chip states (Task 3 Step 2); "# tells us how many" → `· N`; no presence roster → nothing but a number anywhere; count updates live both directions → awareness change → channel emit (Task 2).
- **Non-joined devices see nothing** (chip stays "Join") — matches David's scope; noted as a deliberate limitation in the PR body via the scope line.
- **Type consistency:** `AwarenessLike` defined in Task 2 and consumed by its tests; `sessionCount` name identical across `BandSessionState`, App prop, and view prop; factory third arg named `awareness` everywhere.
- **Risk note:** y-webrtc with a shared awareness also broadcasts it over BroadcastChannel — required for the two-tab verification to work; verified by reading the installed y-webrtc source (`awareness` option, BC tier shares the update pipeline).
