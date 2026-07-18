# Band Book Sync Split (PR 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement spec Part 1 ([2026-07-18 design](../specs/2026-07-18-band-book-and-performance-view-design.md)): the network providers attach whenever a band room is configured — no toggle — so Band Book data (set lists, per-song key/tempo/arrangement, corrections) always syncs; the renamed **Session** toggle gates only the live layer (playback follow + song follow).

**Architecture:** `bandSession.ts` currently couples "attach the network" to the on/off toggle. This PR decouples them: attach happens at creation whenever the room is *explicitly configured*, and `setOn` only flips the session flag (plus ensures attach on first join). The session flag continues to gate exactly what it already gates downstream — `publishSession` in `syncedSessionStore` and the `enabled:` predicate of the transport/song followers — so **no downstream code changes**. Yjs writes for setlists/songSettings/corrections are already ungated; this makes the transport match the write policy.

**Tech Stack:** Svelte 5, TypeScript, Yjs + y-webrtc/y-partyserver behind `ProviderFactory`, Vitest.

## Global Constraints

- Land via PR into `main`; branch `feat/band-book-sync-split` off current `origin/main`. (The main freeze lifts post-gig; opening the PR is always safe.)
- **Privacy invariant:** the DEFAULT band name (`soundcheck`, shared by every fresh install) must NEVER auto-attach on its own. "A band room is configured" = a band name was explicitly saved (typed, or arrived via a `?band=` link — both write `bandaid.band.v1`) **or** the device ever used the sync toggle (`bandaid.syncOn.v1` exists, either value). A truly fresh install stays local until the user configures.
- **Continuity invariant:** David's and the guitarist's devices (which have used the toggle) must attach on first boot after this update with zero taps. Spec: both devices receive this change together; ships **without** a feature flag.
- The session flag keeps its storage key `bandaid.syncOn.v1` (existing opt-ins survive) and keeps gating: `publishSession` ([syncedSessionStore.ts:112,123](src/sync/syncedSessionStore.ts)), transport follower ([ChordChangesView.svelte:387](src/views/ChordChangesView.svelte) `enabled: () => sync.on`), song follower ([App.svelte:86](src/App.svelte) `enabled: band.isOn`). None of those lines change.
- UI copy: the settings row renames from **Sync** to **Session**, chip reads **Join** / **Joined** (spec: "renamed to reflect joining a session"). The Band name row and SyncBadge stay.
- No VERSION/CHANGELOG/TODOS files. Test commands: `npm test`, `npm run check` (`npm run remix:check` untouched by this PR must stay green).
- Dev-PC-only testing: desktop-browser verification in this PR; real two-device Band Book propagation (the spec's "setlist edit with session off propagates iOS→Android") is checked later on the beta channel — note it in the PR body.

---

### Task 1: `hasSavedBandName` in bandCode

**Files:**
- Modify: `src/sync/bandCode.ts`
- Test: `src/sync/bandCode.test.ts`

**Interfaces:**
- Produces: `export function hasSavedBandName(storage?: StorageLike | null): boolean` — true iff `bandaid.band.v1` exists. Task 3 passes it to `createBandSession` as `autoAttach`.

- [ ] **Step 1: Create the branch**

```bash
git checkout main && git pull && git checkout -b feat/band-book-sync-split
```

- [ ] **Step 2: Write the failing tests**

Append to `src/sync/bandCode.test.ts` (match the file's existing fake-storage helper if one exists; otherwise use this inline map — read the file first and reuse its helpers):

```ts
describe('hasSavedBandName', () => {
  it('is false on a fresh install (default name is not "configured")', () => {
    const storage = fakeStorage();
    expect(hasSavedBandName(storage)).toBe(false);
    // Reading the (default) name does not configure anything.
    readBandName('', storage);
    expect(hasSavedBandName(storage)).toBe(false);
  });

  it('is true after an explicit save, and after a ?band= link (which persists)', () => {
    const a = fakeStorage();
    saveBandName('Rhythm Cats', a);
    expect(hasSavedBandName(a)).toBe(true);

    const b = fakeStorage();
    readBandName('?band=rhythm-cats', b); // links write the key by design
    expect(hasSavedBandName(b)).toBe(true);
  });
});
```

Import `hasSavedBandName` in the test file's import list.

- [ ] **Step 3: Run to verify failure**

Run: `npx vitest run src/sync/bandCode.test.ts`
Expected: FAIL — `hasSavedBandName` is not exported.

- [ ] **Step 4: Implement**

Add to `src/sync/bandCode.ts`:

```ts
/**
 * True once a band name has been explicitly saved — typed into settings, or arrived
 * via a ?band= link (readBandName persists those). Gates the Band Book's auto-attach:
 * the DEFAULT name must never connect on its own, because every fresh install shares
 * it and the Band Book must not sync with strangers.
 */
export function hasSavedBandName(storage: StorageLike | null = safeStorage()): boolean {
  return readItem(storage, KEY) !== null;
}
```

- [ ] **Step 5: Run to verify pass**

Run: `npx vitest run src/sync/bandCode.test.ts`
Expected: PASS (existing + 2 new).

- [ ] **Step 6: Commit**

```bash
git add src/sync/bandCode.ts src/sync/bandCode.test.ts
git commit -m "feat(sync): hasSavedBandName — explicit band config predicate"
```

### Task 2: Decouple network attach from the session flag in bandSession

**Files:**
- Modify: `src/sync/bandSession.ts`
- Test: `src/sync/bandSession.test.ts` (rewrite — the old tests encode the old coupling)

**Interfaces:**
- Consumes: nothing new.
- Produces: `createBandSession(opts)` gains optional `autoAttach?: boolean`. Semantics: providers attach at creation when `autoAttach` is true OR `bandaid.syncOn.v1` exists (either value); `setOn(true)` ensures attach; `setOn(false)` leaves providers attached; `setRoom` ensures attach (an explicit room set is configuration) and reconnects only on an actual code change; only `destroy()` disconnects. `BandSession`/`BandSessionState` shapes unchanged.

- [ ] **Step 1: Rewrite the test file**

Replace the `describe('createBandSession', ...)` block in `src/sync/bandSession.test.ts` with (keep the existing `fakeStorage`/`spyFactory`/`setup` helpers; add an `autoAttach` passthrough to `setup`):

```ts
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
```

- [ ] **Step 2: Run to verify failures**

Run: `npx vitest run src/sync/bandSession.test.ts`
Expected: FAIL — several cases (autoAttach unknown option is ignored by TS at runtime but attach never happens; `setOn(false)` disconnects; `'0'` seed doesn't attach).

- [ ] **Step 3: Implement the rework**

Replace the body of `createBandSession` in `src/sync/bandSession.ts` (and update the file's header comment):

```ts
/**
 * Owns the network lifecycle of the shared doc, split in two tiers (Band Book design,
 * spec 2026-07-18 Part 1):
 *
 *  - NETWORK ATTACH (Band Book): providers attach whenever a band room is CONFIGURED —
 *    an explicitly saved band name (autoAttach) or any previous use of the session
 *    toggle (the syncOn key exists, either value). Once attached, durable Band Book
 *    data (set lists, song settings, corrections) syncs whenever the device is online.
 *    Only destroy() detaches. A truly fresh install stays local: the DEFAULT band name
 *    is shared by every install and must never connect on its own.
 *
 *  - SESSION (live layer): the on/off flag — persisted so an iOS tab reload doesn't
 *    drop a joined device mid-rehearsal — gates only what publishes/follows live
 *    stamps (transport + song follow). It no longer touches the network.
 */
export function createBandSession(opts: {
  doc: Y.Doc;
  room: string;
  factories: ProviderFactory[];
  storage?: StorageLike | null;
  /** A band room is explicitly configured — attach the providers at creation. */
  autoAttach?: boolean;
}): BandSession {
  const storage = opts.storage === undefined ? safeStorage() : opts.storage;
  let room = opts.room;
  let on = false;
  let attached: AttachedSync | undefined;
  let unsubStatus: (() => void) | undefined;

  const getState = (): BandSessionState => ({
    on,
    status: attached?.getStatus() ?? { providers: {} },
  });
  const channel = createChannel(getState);

  // onStatusChange delivers the current status immediately on subscribe, so attaching
  // itself emits the freshly-connected state.
  function ensureAttached() {
    if (attached) return;
    attached = attachProviders(opts.doc, room, opts.factories);
    unsubStatus = attached.onStatusChange(() => channel.emit());
  }
  function disconnect() {
    unsubStatus?.();
    unsubStatus = undefined;
    attached?.disconnect();
    attached = undefined;
  }

  function setOn(next: boolean) {
    if (next === on) return;
    on = next;
    writeItem(storage, SYNC_ON_KEY, next ? '1' : '0');
    // Joining is a configuring act (the user chose a room to join). Leaving the
    // session never detaches — the Band Book keeps syncing.
    if (next) ensureAttached();
    channel.emit();
  }

  // Attach policy at creation — see the header comment.
  if (opts.autoAttach || readItem(storage, SYNC_ON_KEY) !== null) ensureAttached();
  // Resume a previous session join across reloads.
  if (readItem(storage, SYNC_ON_KEY) === '1') on = true;

  return {
    getState,
    isOn: () => on,
    setOn,
    setRoom(code) {
      // An explicit room set is a configuring act: make sure we're attached even if
      // the code didn't change (e.g. re-confirming the prefilled name).
      if (code === room) {
        ensureAttached();
        return;
      }
      room = code;
      if (attached) disconnect();
      ensureAttached();
      channel.emit();
    },
    subscribe: channel.subscribe,
    destroy: disconnect,
  };
}
```

Keep `SYNC_ON_KEY`, imports, and the `BandSessionState`/`BandSession` interfaces as they are.

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/sync/bandSession.test.ts`
Expected: PASS, 12 tests.

- [ ] **Step 5: Full suite (downstream contracts unchanged)**

Run: `npm test`
Expected: all pass — `syncedSessionStore`, `transportFollower`, `follower` tests are untouched because the session flag's gating contract didn't change.

- [ ] **Step 6: Commit**

```bash
git add src/sync/bandSession.ts src/sync/bandSession.test.ts
git commit -m "feat(sync): Band Book always attaches when configured; toggle becomes session-only"
```

### Task 3: App wiring + Session UI copy

**Files:**
- Modify: `src/App.svelte:24-42` (wiring + comments)
- Modify: `src/views/ChordChangesView.svelte:41-49` (prop doc comment), `:770-779` (sheet row)

**Interfaces:**
- Consumes: `hasSavedBandName()` (Task 1), `autoAttach` option (Task 2).
- Produces: user-visible copy only; the `sync` prop shape passed to ChordChangesView is unchanged.

- [ ] **Step 1: Wire autoAttach in App.svelte**

Update the import and the band-session creation:

```ts
import { readBandName, saveBandName, bandRoomCode, hasSavedBandName } from './sync/bandCode';
```

Replace the comment block + `createBandSession` call (lines 24-38):

```ts
// One Yjs doc, three attachments: the synced store (app-facing API), always-on
// IndexedDB persistence, and the band session. The network attaches whenever the
// band room is CONFIGURED (a saved band name — typed or via ?band= link — or any
// previous use of the session toggle): Band Book data (set lists, song settings,
// corrections) syncs without any toggle. "Join session" is the separate, live
// layer — playback + song follow — and is what the settings toggle controls.
const ydoc = createBandDoc();
// A `?band=` link prefills AND persists the band name — that counts as configured.
const initialBandName = readBandName(typeof location !== 'undefined' ? location.search : '');
let bandName = $state(initialBandName);
const host = import.meta.env.VITE_SYNC_HOST;
const band = createBandSession({
  doc: ydoc,
  room: bandRoomCode(initialBandName), // later edits go through setBandName → band.setRoom
  factories: [webrtcProvider, ...(host ? [partyserverProvider(host)] : [])],
  autoAttach: hasSavedBandName(),
});
```

(The `publishSession: band.isOn` line and both followers stay exactly as they are.)

- [ ] **Step 2: Rename the settings row in ChordChangesView.svelte**

Replace the sync row (the `<!-- Band sync: ... -->` comment + the `Sync` row div):

```svelte
    <!-- Session: the opt-in LIVE layer — follow the band's song switches and playback
         together. Set lists, keys, tempos, and arrangements are Band Book data: they
         sync whenever the device is online and the band is configured, no toggle
         (spec 2026-07-18 Part 1). The badge shows the Band Book connection. -->
    <div class="row">
      <span class="label">Session</span>
      <div class="chips">
        <button
          class:active={sync.on}
          aria-pressed={sync.on}
          onclick={sync.toggle}
          title="Follow the band's song switches and playback together — set lists, keys and tempos sync on their own"
        >{sync.on ? 'Joined' : 'Join'}</button>
      </div>
      <SyncBadge summary={sync.summary} />
    </div>
```

And update the `sync` prop's doc comment at the top of the component:

```ts
    // Session controls for the settings sheet: the network (Band Book) attaches on its
    // own once the band is configured; this toggle only joins/leaves the live session
    // (playback + song follow).
```

- [ ] **Step 3: Typecheck + full suite**

Run: `npm test && npm run check`
Expected: all tests pass, 0 svelte-check errors/warnings.

- [ ] **Step 4: Browser verification (desktop dev server)**

With the dev server on this branch (`preview_start` config `dev`), on `http://localhost:5173`:

1. Open a song → settings sheet (☰): row reads **Session** with a **Join**/**Joined** chip and the badge next to it; the **Band** row below is unchanged.
2. This profile has used sync before → the badge shows a live provider state (e.g. "P2P connecting…"/"Local only" depending on network) even while the chip reads **Join** — that's the Band Book attached with the session off. Confirm the badge is NOT stuck at the pre-change off-state label.
3. Tap **Join** → chip reads **Joined**, active styling; badge unchanged (network was already attached — no reconnect flash).
4. Tap **Joined** → back to **Join**; badge STILL shows the attached state (leaving the session must not drop the network).
5. Edit the Band name → badge re-connects to the new room (brief status change); session chip state unchanged.
6. Console: no errors.
7. Screenshot the sheet for the PR.

(Two-device Band Book propagation and the session-gating of playback follow are covered by unit tests here; live cross-device checks happen on the beta channel per the rollout plan.)

- [ ] **Step 5: Commit, push, open the PR (do NOT merge until the stack ahead is in)**

```bash
git add src/App.svelte src/views/ChordChangesView.svelte
git commit -m "feat(sync): session toggle UI — Band Book syncs on its own"
git push -u origin feat/band-book-sync-split
gh pr create --title "feat: Band Book sync split — set lists & song settings always sync" --body "PR 2 of the Band Book + performance view plan (spec Part 1, docs/superpowers/specs/2026-07-18-band-book-and-performance-view-design.md).

**The rehearsal surprise this fixes:** a setlist reorder on iOS never reached the Android tablet because both ran with Sync off — the toggle gated the *connection*, not just playback.

- Network providers now attach whenever the band room is **configured** (saved band name, \`?band=\` link, or any prior use of the sync toggle) — Band Book data (set lists, per-song key/tempo/arrangement, corrections) syncs whenever the device is online
- The toggle is renamed **Session — Join/Joined** and gates only the live layer (playback follow + song follow), via the existing \`publishSession\` and follower \`enabled:\` hooks (no downstream changes)
- **Privacy:** a truly fresh install (default band name, never toggled) stays fully local — the shared default room must not sync strangers' Band Books
- Both band devices qualify as configured via their existing localStorage keys, so they attach on first boot after this deploys — no taps needed; ships without a feature flag (update both devices together)

**Verification:** 12 rewritten bandSession unit tests + new bandCode tests; full suite + svelte-check green; desktop browser walkthrough of the Session row (badge live while un-joined, join/leave doesn't touch the network, band rename re-attaches). Two-device propagation check happens on the beta channel per the rollout plan.

**Merge after PR #57 and #58 (stack order 0 → 1 → 2).**

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

---

## Self-review notes

- **Spec coverage (Part 1):** always-attach → Task 2 attach policy + Task 3 `autoAttach` wiring. Toggle gates only the session layer → Task 2 `setOn` (flag-only) + unchanged `publishSession`/follower hooks. Rename → Task 3 Step 2. "No data migration needed" → confirmed: no schema change, CRDT merge on reconnect pre-exists. "Both devices together, no flag" → PR-body deploy note.
- **Deliberate deviation:** the spec says attach "whenever the app is online and a band room is configured"; the spec's own implementation note doesn't define *configured*. This plan defines it as explicitly-saved-name-or-prior-toggle-use to preserve the privacy of the shared default room — a fresh install must not join `soundcheck` unprompted. Flag this to David in the PR.
- **Not in this PR (Part 1 text, no PR-2 test in spec):** the personal practice-tempo-% layer over the Band Book tempo ("local playback may run at a personal percentage"). Today `tempoPct` stays the single shared value. That's a UX-visible feature (two tempo concepts) that belongs with the Part 3/4 performance-view work or its own PR — noted for the PR-3 planning conversation.
- **Type consistency:** `autoAttach?: boolean` (Task 2) matches Task 3's `autoAttach: hasSavedBandName()`; `hasSavedBandName(storage?)` defined in Task 1 and imported in Task 3.
