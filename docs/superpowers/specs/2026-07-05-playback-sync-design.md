# Design: Playback sync (live session state)

Date: 2026-07-05
Status: Approved design — ready for implementation plan
Feature spec (UX + requirements): [docs/project/features/playback-sync.md](../../project/features/playback-sync.md)
Ratified ground rules: [ADR-002](../../project/architecture-decisions/002-sync-stack.md) (D1–D5)
Build sequence context: [multi-user-review-and-plan.md](../../project/multi-user-review-and-plan.md) §4 Phase 3

## Context

The corrections sync substrate is shipped: one Y.Doc per band code, layered providers
(IndexedDB / PartyServer / WebRTC / export), identity, a sync badge, and — since the
substrate landed — live band sync of `songSettings` (tempo %, transpose). What does
**not** sync yet is the live playhead state: `currentSongId` and `transport` are
session-local in-memory fields of `syncedSessionStore` (`src/sync/syncedSessionStore.ts:41-42`),
and **no production code follows remote state** (gap G1 — writes are fire-and-forget).

This design makes the reserved `session` map live: multi-writer transport intents,
shared current song, and the follower (remote-apply) layer, implementing ADR-002 D2's
conflict rules exactly. It changes no server code — the PartyServer worker relays any
doc content.

## Goals / Non-goals

**Goals**
- Any member's play / pause / seek and song choice reach every device; each device
  projects its own playhead (`projectBar`) from the shared stamp. No host, no clock owner.
- Implement ADR-002 D2 precisely: intent-vs-anchor stamp routing, `issuedAt`
  last-press-wins on apply, `authorId` echo guard, clamp-on-apply-never-write-back.
- The follower path is unit-testable headless (fake renderer + injected clock/scheduler).
- Log skew samples (G3) as the M4 gate evidence.
- Session-of-one behavior byte-identical without a band code.

**Non-goals**
- Presence UI, shared set-list position (Phase 4), NTP clock sync (M4), LAN signaling,
  looping, band-join UX beyond the existing `?band=` link.
- Syncing tempo/key through transport intents — `songSettings` already does this (shipped).
- Server/worker changes.

## Architecture

```
                        ┌────────────── Y.Doc (per band code) ──────────────┐
                        │ corrections   songSettings   session   meta       │
                        │                              ├ transport (intent) │
                        │                              └ song               │
                        └──────────▲──────────────────────────┬─────────────┘
                                   │ doc write (intent only)  │ observer (own channel)
   user action                     │                          ▼
  ┌──────────┐  play/pause/seek ┌──┴───────────────┐   ┌────────────────────┐
  │ controls │ ───────────────► │ syncedSession-   │──►│ transportFollower  │
  └──────────┘                  │ Store.setTrans-  │   │ (order/echo/song/  │
        │                       │ port(t, meta)    │   │  staleness guards, │
        ▼                       └──▲───────────────┘   │  skew log)         │
  ┌──────────────┐   anchor stamps │ (local only)      └─────────┬──────────┘
  │ localTrans-  │ ────────────────┘                             │ apply
  │ port.stamp() │ ◄─────────────────────────────────────────────┘
  └──────┬───────┘        applyRemote(stamp): seek/schedule-play/pause,
         ▼                count-in suppressed, restamps origin 'remote'
     alphaTab player (each device's own clock)
```

Three layers, each with one job:

1. **Origin routing** (`localTransport` + the `SessionStore` seam). Every stamp is
   tagged: `{origin:'intent', kind}` for user actions (play, pause, seekToBar, paused
   tap-a-bar), `{origin:'anchor'}` for mechanical re-anchors (repeat/volta jumps, the
   tempo-continuity restamp), `{origin:'remote'}` for stamps produced by applying a
   peer's intent. Only `intent` reaches the doc. This is the ADR-002 D2.1 seam change.
2. **The doc + ordered delivery** (`doc.ts` session accessors + `syncedSessionStore`).
   `session.transport` and `session.song` are whole-object keys (a stamp is only
   coherent as a unit — field-keying like `songSettings` would let two stamps
   interleave). The synced store decorates intent writes with `issuedAt: now()`,
   `authorId`, `kind`, and exposes **dedicated subscription channels**
   (`subscribeSessionTransport` / `subscribeSessionSong`) — the songSettings lesson:
   never let a transport emit masquerade as another channel's update.
3. **The follower** (`transportFollower` + `localTransport.applyRemote`). The follower
   is pure bookkeeping: drop `null`, record-but-don't-apply own-author stamps, drop
   other songs' stamps, drop stamps not newer than the last applied `issuedAt`, log a
   skew sample, delegate to `applyRemote`. `applyRemote` owns the mechanics against the
   renderer and restamps the resulting local state with origin `'remote'` so every
   existing consumer (overlay projection, scrubber, play button) follows for free.

### Why the doc, not Yjs awareness

Transport could ride awareness (ephemeral presence state), but the late-join story
*requires durability*: a joiner must find the current song and the last intent in the
doc even if it arrives during a lull. Awareness is the right tool for the deferred
presence UI, not for state with a "what is true now" reading. One `session` map key per
concern, whole-object values, Yjs-level LWW per write, app-level `issuedAt` ordering on
apply (Yjs resolves storage conflicts by causality + client id, not wall-clock — ADR-002 D2).

## Data shapes (in `src/session/types.ts`)

```ts
export type TransportIntentKind = 'play' | 'pause' | 'seek';

export type TransportStampMeta =
  | { origin: 'intent'; kind: TransportIntentKind }
  | { origin: 'anchor' }
  | { origin: 'remote' };

/** The doc value at session.transport. */
export interface SharedTransportIntent extends Transport {
  issuedAt: number;   // wall-clock ms of the user action — the LWW comparison key
  authorId: string;   // stable per-device id — the echo guard
  kind: TransportIntentKind;
}

/** The doc value at session.song. */
export interface SharedSongIntent {
  songId: string;
  issuedAt: number;
  authorId: string;
  author: string;     // display name at stamp time (for the switch notice)
}
```

`SessionStore.setTransport` gains an optional meta parameter, **defaulting to
`{origin:'anchor'}`** — the safe default: an untagged write can never leak to the band.
The local store (`session/store.ts`) accepts and ignores the parameter; existing
callers and tests compile unchanged.

## Apply rules (the heart of it)

The follower (per loaded song, created at `onReadyForPlayback`, fed by
`subscribeSessionTransport` which delivers the current value on subscribe):

1. `stamp === null` → ignore.
2. `stamp.authorId === myAuthorId` → set `lastApplied = max(lastApplied, issuedAt)`,
   do **not** apply (echo guard; the local transport already did the action).
3. `stamp.songId !== loadedSongId` → ignore (the song intent drives switches; a fresh
   follower is created per song, so cross-song stamps can never mis-apply).
4. `stamp.issuedAt <= lastApplied` → ignore (ADR-002 D2.2: compared only against
   applied *intents*, never against local anchor re-anchors).
5. Otherwise: `lastApplied = issuedAt`, record skew sample `(now − issuedAt)`, apply.

`applyRemote(stamp)` mechanics (in `localTransport`, which owns the renderer seam and
the internal `playing`/`currentBar`/`pct` state):

| Case | Action |
|---|---|
| `playing:false` (kind `pause`, or `seek` while paused) | cancel any scheduled start; `renderer.pause()`; `seekToBar(round(startBar))`; restamp `'remote'` |
| `playing:true`, kind `seek`, locally playing | `seekToBar(round(startBar))` (alphaTab keeps playing through a tick seek); restamp `'remote'` |
| `playing:true`, otherwise (cold join, or a `play` while locally paused) | **scheduled start:** `delay = startTimestamp − now()`. If `delay > 0`: seek to `round(startBar)`, `setCountInVolume(0)`, schedule `renderer.play()` in `delay` ms (cancellable), restamp `'remote'` with the stamp's future `startTimestamp` (projectBar floors elapsed at 0, so the playhead holds). If `delay ≤ 0`: **late join** — `projected = projectBar(stamp, now, qpb)`; if `projected > measureCount` **or** `now − issuedAt > 10 min` → land paused at bar 1 (stale-stamp guard); else seek to `floor(projected)`, `setCountInVolume(0)`, play, restamp `'remote'` re-anchored at `{startBar: floor(projected), startTimestamp: now}` (local consistency beats a shared-but-wrong anchor on an approximate join) |

Never touched by `applyRemote`: playback speed. Tempo is `songSettings`' domain (D1 in
the feature spec); the view's existing `subscribeSongSettings` handler already applies
remote tempo/transpose. The stamp's `tempo` field is used for projection math only.

**Any local user action cancels a pending scheduled start** (the user's own intent wins
and publishes, superseding the scheduled one on every device by `issuedAt`).
`LocalTransport.dispose()` also cancels it (song switch / unmount).

### Interaction with count-in future-stamps

The initiator's `play()` stamps `startTimestamp: now + countInMs` (existing behavior).
Followers receiving during that window schedule their start for the same instant —
everyone's downbeat coincides with the initiator's first audible bar. `issuedAt` (not
`startTimestamp`) orders conflicts, so a pause pressed during the window still wins
(ADR-002 D2.2's exact scenario).

### Late joiners and repeats (accepted v1 limitation)

`projectBar` is linear; repeat barlines make real position lag the linear projection
(every device *present at the intent* is exact — its own alphaTab traverses repeats;
only cold joins project). v1 accepts approximate joins: right song, right tempo, right
state, position within the linear estimate; the next band pause/seek/play aligns
exactly, and a playing tap-a-bar lets the joiner self-correct without moving the band
(local-only, ADR-002 D2.1). **Fast-follow spike if it bites:** alphaTab's tick cache
(`getMasterBarStart`, `api.tickPosition`) may support an elapsed-time → repeat-aware
position mapping; investigate before ever considering syncing anchors (which ADR-002
D2.1 forbids for good reasons — N writers × every repeat × mutual clock skew).

## Song switching

- `syncedSessionStore.setCurrentSong(songId)` now also writes
  `session.song = {songId, issuedAt, authorId, author}`. Its only caller is the picker
  path (`openSong`) after the App.svelte split below.
- **App.svelte splits `showSong` (render + `saveLastSong`, no store write) from
  `openSong` (pushState + `store.setCurrentSong` + `showSong`)** — resolving the review
  addendum §3 write-back hazard: boot resume, deep links, and popstate call `showSong`
  only, so they never publish (feature D6). Back/Forward is local browsing.
- The App subscribes to `subscribeSessionSong`: skip own-author stamps and stamps not
  newer than the last applied one; on a real remote switch, `history.replaceState` the
  new `?song=`, render via `showSong`, and show the transient named notice. If the
  library service isn't ready yet, hold the latest stamp and apply once it is.
- The remote-loaded song then creates its own follower, which cold-applies the current
  `session.transport` — a joiner mid-set lands on the song *and* its playing state.

## Skew measurement (G3 → M4 gate)

`src/sync/skewLog.ts`: a capped ring buffer (200 samples) of
`{kind, issuedAt, receivedAt, deltaMs}` recorded by the follower on every applied
remote intent, plus a `summary()` (count/min/median/p90/max). App exposes it as
`window.__bandaidSkew` so a rehearsal dogfood can read numbers from the console.
`deltaMs` conflates one-way latency and clock skew — fine: what M4 needs to know is the
*total* observed offset budget, and its sign distribution reveals gross skew.

## What is shared vs local (delta to ADR-002's table)

Shared (new): `session.transport` (intent stamps only), `session.song`.
Local (unchanged + new): anchor/remote restamps, the scheduled-start timer, the skew
buffer, count-in pref, and everything ADR-002 already enumerates.

## Testing

All headless (Node, no jsdom), following the existing fake-renderer/injected-clock patterns:

- **Origin routing:** a spy store asserts play/pause/seek/paused-tap stamp
  `intent`+kind; repeat-jump and tempo restamps stamp `anchor`; `applyRemote` stamps
  `remote`. (Closes the "no test exercises a simulated remote Transport apply" gap.)
- **Doc + store:** session accessors round-trip; intent writes carry
  `issuedAt`/`authorId`/`kind`; anchor writes don't touch the doc; two-doc convergence
  delivers the stamp to `subscribeSessionTransport`; channel isolation (a session write
  fires neither corrections nor songSettings channels, and vice versa);
  `setCurrentSong` writes `session.song`.
- **Follower:** LWW ordering, echo guard (own stamps advance the cursor without
  applying), song filter, staleness rule, skew samples recorded.
- **applyRemote:** every row of the apply-rules table, with a fake scheduler for the
  future-start case and a fake clock for projection/staleness.
- **Regression:** the entire existing suite unchanged (optional-parameter seam), and
  the session-of-one invariant (no band code ⇒ no session-map observers change behavior).
- **Manual two-context e2e** per the plan's final task: two browsers, one band code,
  the feature-spec acceptance walk.

## Risks & constraints

- **Clock skew as playhead offset (G3):** unmitigated by design in v1 (phones NTP-sync
  at OS level; expected < ~200 ms). Measured, not corrected; M4 decides on evidence.
- **iOS Safari audio unlock:** a follower device that has never been tapped cannot
  start audio. Existing mitigation stands (controls wait for `onReadyForPlayback`;
  first tap unlocks). A device that joined and tapped once is fine thereafter; a truly
  untouched device follows visually the next time the user taps anything. Watch on the
  iPad during dogfooding.
- **`session.transport` write rate:** one object write per user action (not per beat,
  not per repeat) — negligible for PartyServer/WebRTC. Anchor stamps staying local is
  what keeps it so.
- **Stale playing stamps:** bounded by the projection-past-end + 10-minute guards.
- **Simultaneous song switch + transport intent:** independent keys; the per-song
  follower simply ignores transport stamps until the song matches.

## Scope boundary

**In scope:** origin routing at the `setTransport` seam; `session` doc accessors;
synced-store session channels + intent decoration; `transportFollower`; `applyRemote` +
`dispose`; ChordChangesView follower wiring; App.svelte song split/follow/notice; skew
log + console hook; tests throughout; docs status updates.

**Out of scope:** presence UI, shared set list, NTP sync, LAN signaling, join UX, server
changes, repeat-aware projection (spike note only), promoting playing-tap to intent.

## Open questions

Carried in the feature spec (escape-hatch toggle, repeat-aware projection, playing-tap
promotion, author attribution beyond the song notice) — none block implementation;
defaults are chosen and documented there.
