# Feature: Playback Sync

> Specification generated on 2026-07-05
> Part of: M2 (Join) — Phase 3 "Live session state" of the [multi-user review & plan](../multi-user-review-and-plan.md) §4
> Sync stack: [ADR-002](../architecture-decisions/002-sync-stack.md) (Yjs + layered providers; conflict rules D2)
> Technical design: [2026-07-05-playback-sync-design.md](../../superpowers/specs/2026-07-05-playback-sync-design.md)
> Builds on: [local-transport](local-transport.md) · [renderer-playhead](renderer-playhead.md) · corrections sync substrate (shipped)

## Overview

**Purpose:** Turn the session of one into a live session of N. Any band member's play, pause, seek, or song choice reaches every device in the band; each device computes its own playhead locally from the shared stamp (loose follow-along, no host, no leader).

**User Story:** As any member of the band, when I press Play (or pause, jump to the B part, slow it down, or open the next tune), I want everyone's device to follow along, so the whole band stays locked to the same musical position without anyone being "the leader."

**Scope:** This feature makes the shared `session` state live: multi-writer transport intents (play/pause/seek) over the Y.Doc, shared `currentSongId`, the **follower path** (remote state → local renderer) that M1 deliberately deferred, and the skew/drift measurement that gates M4. Tempo and key are *already* band-synced via `songSettings` (shipped) — this feature does not duplicate them.

It explicitly does **NOT** include: presence UI ("who's online" stays deferred, review risk R4), shared set-list position (Phase 4), NTP-style clock tightening (M4, gated on the measurements this feature logs), band-code entry/join UI beyond the existing `?band=` link, looping, or any change to what is local-only (zoom, scroll, part selection, audio toggles, count-in preference).

## Core Principle Link

"No modes, only a session + local presentation templates." This feature is the payoff of that principle: joining is additive, a session of one and of five run the same code, and with no band code the app behaves exactly as it does today. What is shared stays tiny and logical — the intent Transport, the current song — and everything visual stays local. No one is the clock: each device projects the playhead itself from the stamp (`projectBar`), so a dropped peer is a non-event and there is no host to migrate.

## Design Decisions (from /design-feature analysis, 2026-07-05)

| # | Decision | Rationale |
|---|----------|-----------|
| D1 | **Transport intents are play / pause / seek only; tempo and key keep syncing via `songSettings`.** | Tempo/transpose sync shipped with the corrections substrate and already reaches every device. A second tempo channel through transport intents would double-apply and invite ping-pong. `Transport.tempo` stays in every stamp as the projection anchor, but a tempo *change* is not a transport intent. |
| D2 | **Followers are never given a count-in.** A remote play stamp with a future `startTimestamp` (the initiator's count-in window) makes followers seek immediately and *schedule* playback to start at that instant. | Count-in is a local, never-synced pref (local-transport FR-9). The initiator hears their own count-in; in the same room that *is* the band's count-in. Scheduling to the stamped instant keeps everyone's downbeat aligned without imposing a pre-roll (local-transport edge case: "local count-in is NOT imposed when following a remote start"). |
| D3 | **Pause is a re-sync moment: followers pause *and align* to the pauser's bar.** | Cheap, musically natural drift correction — after any pause the whole band is provably on the same bar, so the next play starts everyone together. |
| D4 | **A remote intent applied while already playing the same song never re-seeks except for an explicit `seek`.** | A well-synced follower's own position is better than a linear re-projection. Stamps carry a `kind` (`play`/`pause`/`seek`) written by the device that knows which action it was — no fragile inference on the receiver. |
| D5 | **Late/re-joiners land on the right song, tempo, and playing state; the *position* is approximate** (linear `projectBar` projection, floor-of-bar seek). A playing stamp that projects past the end of the song, or is older than 10 minutes, lands the joiner **paused at bar 1** instead. | Linear projection ignores repeat barlines, so mid-tune joins drift after the first repeat — accepted for v1 ("loose follow-along first", roadmap M2→M4 gate). The guards keep a stale `playing` stamp (someone closed the app mid-tune yesterday) from haunting tomorrow's session. Any fresh band intent snaps the joiner in exactly. |
| D6 | **Only an explicit picker tap publishes a song switch. Boot resume, deep links, and browser Back/Forward are local-only navigation.** | Opening the app at home must not yank the whole band to your last song. Back is for *your* navigation (it returns to the picker); remote switches use `history.replaceState` so Back never walks through a bandmate's changes (review addendum §3). |
| D7 | **A remote song switch shows a brief, named, non-blocking notice** ("Kate switched to Soldier's Joy"); remote transport follows show nothing extra. | A song swapping "by itself" with zero explanation feels haunted, and the name is the social cue a leaderless band runs on. Play/pause/seek are already visible in the controls themselves (button flips, scrubber jumps) — a toast per transport event would be noise. |
| D8 | **Conflict rule is ADR-002 D2 verbatim:** intent stamps carry wall-clock `issuedAt` + `authorId` + `kind`; apply iff `issuedAt` is newer than the last applied intent; ignore your own echoes; clamp on apply, never write back. Anchor re-stamps (repeat/volta re-anchors, tempo-continuity restamps) stay local-only. | Pre-decided in ADR-002; this feature implements it. `startTimestamp` is a projection anchor deliberately stamped in the future through count-in and must never order conflicts. |
| D9 | **Playing tap-a-bar stays local-only in v1** (paused tap-a-bar and the scrubber sync). | ADR-002's documented seam gap: a playing tap reaches the transport only through `onPosition`, indistinguishable from a repeat jump. Useful side effect: a late joiner can tap themselves back into position without yanking the band. |
| D10 | **Skew/drift is measured, not fixed:** every received intent logs `(receivedAt − issuedAt)` to an in-app ring buffer readable from the console. | G3/M4 gate: the roadmap builds NTP-style sync only if loose follow-along is *measured* insufficient. This feature produces that evidence during real rehearsal. |

## User Flow

### Primary Flow (Happy Path — rehearsal)

```
User Action                          System Response (every device in the band)
──────────────────────────────      ─────────────────────────────────────────────
1. Everyone opens their band        Each device shows the sync badge "Synced";
   link (?band=… remembered            session state loads from the doc.
   from last time).
2. Anyone picks "Soldier's Joy"     All other devices load the song and show
   from the set list.                  "〈name〉 switched to Soldier's Joy" briefly.
3. Anyone presses Play.             Initiator hears their count-in; every other
                                       device seeks to the start bar and begins
                                       playing exactly at the stamped downbeat.
4. Anyone drags tempo to 90%.       All devices' tempo changes live (existing
                                       songSettings sync); playback stays continuous.
5. Anyone drags the scrubber        Every device jumps there, still playing.
   to the B part (bar 9).
6. Anyone presses Pause.            Every device pauses AND aligns to the same bar.
7. Play again.                      Everyone starts together from that bar.
```

### Late / re-joiner flow

```
1. Fiddler's iPad slept mid-tune;   On reopen the doc re-syncs: the app loads the
   she wakes it and reopens.           band's current song, applies its tempo/key,
                                       and — if the band is playing and the stamp is
                                       fresh — seeks to the projected bar and plays.
2. Position is a little off         She taps a bar near the fiddle's position —
   (tune has repeats).                 a playing tap is local-only (D9), so she
                                       corrects herself without moving the band.
3. Next band pause or seek.         She is exactly aligned again (D3).
```

### Solo flow (no band code)

Identical to today, byte for byte: no providers attach beyond IndexedDB, no intents leave the device, nothing follows. This is the "no modes" invariant and it is asserted by test.

## Requirements

### Functional Requirements

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-1 | Play, pause, and seek (scrubber or paused tap-a-bar) by any member propagate to every device with the same band code | Must |
| FR-2 | A follower applies a remote play by seeking to the stamped bar and starting playback at the stamped instant (scheduled if `startTimestamp` is still in the future); local count-in is never imposed on a follow | Must |
| FR-3 | A remote pause pauses the follower and aligns it to the stamp's bar | Must |
| FR-4 | A remote seek moves the follower to the stamp's bar, preserving playing state | Must |
| FR-5 | Intent stamps carry `issuedAt`, `authorId`, `kind`; a follower applies a stamp iff its `issuedAt` is newer than the last applied intent's, and never applies its own stamps (echo guard) | Must |
| FR-6 | Anchor re-stamps (repeat/volta re-anchor, tempo-continuity restamp) are never written to the shared doc | Must |
| FR-7 | Opening a song from the picker publishes the switch to the band; all other devices load it (with `history.replaceState`, not `pushState`) and show a transient named notice | Must |
| FR-8 | Boot resume, `?song=` deep links, and Back/Forward navigation never publish a song switch | Must |
| FR-9 | A late/re-joiner lands on the band's current song with its tempo/key applied; if the band is playing on a fresh stamp, the joiner seeks to the linearly projected bar and plays; a stamp projecting past the song end or older than 10 minutes lands paused at bar 1 | Must |
| FR-10 | With no band code, behavior is identical to the current app (session-of-one regression suite stays green) | Must |
| FR-11 | All transport controls reflect followed state (play button, scrubber, overlay playhead move on remote changes) | Must |
| FR-12 | Every received remote intent logs a skew sample `(receivedAt − issuedAt)` to a capped in-app buffer, summarizable from the console | Must |
| FR-13 | Tempo/key changes continue to sync solely via `songSettings`; no transport intent is published for a tempo change | Must |
| FR-14 | Remote values out of local bounds are clamped on apply and never written back (ADR-002 D2.4) | Must |
| FR-15 | Playing tap-a-bar stays local-only (documented v1 acceptance, ADR-002 D2.1) | Must |

### Non-Functional Requirements

| ID | Requirement | Target |
|----|-------------|--------|
| NFR-1 | Intent-to-follower latency | Under ~1 s over the hosted relay on rehearsal Wi-Fi; typically much less over WebRTC. Not perceptible as "laggy" for follow-along |
| NFR-2 | Warm-follower alignment | Bounded by clock skew + audio start latency only; no *accumulating* drift while playing (each device's own player is its clock) |
| NFR-3 | Runs on iPhone, Android, iPad, laptop | All four; the fiddler's iPad is the primary test device (review R2) |
| NFR-4 | No new infrastructure | The existing PartyServer worker relays the `session` map as-is; no server changes, no new deploys |
| NFR-5 | Solo practice loop unaffected | No band code ⇒ no network chatter, no behavior change, no perf cost |

## Data Model

New shared state in the existing Y.Doc's `session` map (reserved by the corrections substrate spec, empty until now):

```typescript
/** session.transport — one whole-object value; a stamp is only coherent as a unit. */
interface SharedTransportIntent extends Transport {
  issuedAt: number;                    // wall-clock ms of the user action (LWW key)
  authorId: string;                    // writer's stable device id (echo guard)
  kind: 'play' | 'pause' | 'seek';     // which action; drives follower apply rules
}

/** session.song — one whole-object value. */
interface SharedSongIntent {
  songId: string;
  issuedAt: number;
  authorId: string;
  author: string;                      // display name at stamp time, for the notice
}
```

### Local-only (unchanged, never synced)

Count-in pref, audio toggles/volumes, zoom, scroll, part selection, chord overlay, masthead, `bandaid.lastSong.v1`, and the *anchor* transport re-stamps. The follower's scheduled-start timer and skew buffer are local runtime state.

## Interface (internal — see technical design for full detail)

```typescript
// session/types.ts — the seam ADR-002 D2 requires: stamps are routed by origin.
type TransportStampMeta =
  | { origin: 'intent'; kind: 'play' | 'pause' | 'seek' }
  | { origin: 'anchor' }    // mechanical re-anchor: local-only
  | { origin: 'remote' };   // applying a peer's intent: local-only
interface SessionStore {
  setTransport(t: Transport, meta?: TransportStampMeta): void; // default { origin: 'anchor' }
  // ...unchanged otherwise
}

// transport/localTransport.ts
interface LocalTransport {
  applyRemote(stamp: SharedTransportIntent): void; // the follower mechanics
  dispose(): void;                                 // cancels a pending scheduled start
  // ...unchanged otherwise
}

// sync/transportFollower.ts — ordering/echo/staleness guards + skew logging
createTransportFollower(deps): { receive(stamp: SharedTransportIntent | null): void };
```

## Edge Cases & Error Handling

| Scenario | Expected Behavior |
|----------|-------------------|
| Two members press Play/Pause near-simultaneously | Newest `issuedAt` wins on apply everywhere (ADR-002 D2); within clock-skew of each other, the actions were genuinely concurrent and either outcome is consistent across devices once the doc converges |
| Pause pressed during someone's count-in window | Applies — `issuedAt` ordering, never `startTimestamp` (which sits in the future through count-in) |
| Song ends naturally (alphaTab auto-stops) | Local stop is not an intent; the doc keeps the old playing stamp. Followers already stopped on their own; joiners are protected by the projection-past-end / 10-minute staleness guards (D5) |
| Remote intent arrives for a different song than loaded | Ignored; the follower is per-song. The song intent drives the switch, after which fresh transport intents apply |
| Remote intent arrives before audio is ready (soundfont loading) | Applied when the player becomes ready (the follower attaches at `onReadyForPlayback`; the latest stamp is delivered on subscribe) |
| Rapid scrubbing by one member | Each stamp is a whole object; LWW by `issuedAt`; followers seek cheaply on each — same as local scrubbing |
| Remote tempo (songSettings) outside the local slider range | Clamped on apply, never written back (existing behavior, ADR-002 D2.4) |
| Band code set but `VITE_SYNC_HOST` unset / worker down | WebRTC tier still syncs when it connects; sync badge already tells the truth about connectivity |
| A member browses Back to the picker mid-tune | Local-only (D6); their device leaves the song view, the band is untouched; re-opening a song from the picker publishes normally |
| Device sleeps and wakes mid-tune | Rejoin = late-joiner flow (D5): right song/tempo/state, approximate position, exact after the next band pause/seek |
| Solo practice while the rest of the band rehearses on the same code | v1: the solo device follows the band (it *is* in the session). Known limitation — see Open Questions |

## Acceptance Criteria

- [ ] Two devices with the same band code: Play on one starts the other within the loose tolerance; either can pause, seek, or change tempo for both. (Phase 3 exit criterion, review §4.) — **pending live two-device verification**
- [ ] Pause on either device leaves both paused on the same bar. — **pending live two-device verification**
- [ ] A play started with count-in on the initiator starts the follower at the stamped downbeat with no count-in of its own. — **pending live two-device verification**
- [ ] Opening a song from the picker loads it on the other device with a named notice; Back on the follower does not traverse the remote switch. — **pending live two-device verification**
- [ ] A device that reloads mid-tune lands on the right song at roughly the right bar, playing; a device joining a band idle for >10 minutes lands paused at bar 1. — **pending live two-device verification**
- [x] Repeat barlines and tempo-continuity restamps produce **no** writes to the shared doc (unit-asserted), and a device's own stamps are never re-applied to it (echo guard, unit-asserted).
- [x] With no band code, the full existing test suite and behavior are unchanged.
- [ ] Skew samples accumulate on every received intent and a summary is readable from the console during a rehearsal. — mechanism unit-tested and confirmed headlessly (`window.__bandaidSkew()` returns the expected shape); **reading real numbers during a live rehearsal is still pending**.
- [ ] All of the above on the fiddler's iPad + one other device class.

## Dependencies

### Depends On
- **Corrections sync substrate (shipped):** the Y.Doc, band code, providers, identity, sync badge.
- **local-transport (M1):** the sole-writer `stamp()` seam this feature tags with origins; `projectBar`.
- **ADR-002:** conflict rule (D2), offline posture (D3), deploy config (D4).
- **alphaTab renderer seams:** `seekToBar`, `play`, `pause`, `setCountInVolume`, `onReadyForPlayback`.

### Depended On By
- **Phase 4 — shared set list:** trivially another `session` key once this lands.
- **M4 — tighten when needed:** consumes the skew/drift evidence (FR-12) as its gate.
- **M3 — lyrics chord-progress:** counts repeat passes off the (still local) anchor restamp stream — unaffected by design (FR-6 keeps anchors local).

## Open Questions

- [x] **"Practice alone while the band plays" escape hatch.** v1 always follows (you're in the session). **Backlogged 2026-07-05 as *independent playheads* ([roadmap](../roadmap.md) M3):** two modes — tethered-apart (local cursor diverges, band position still tracked via a ghost indicator, one-tap snap-back) and fully desynced (leave following entirely, resync via the late-joiner path). Each has its place; design after playback-sync dogfooding. The follower architecture already accommodates both (a local boolean gating `apply()`; snap-back = one cold `applyRemote`).
- [ ] **Repeat-aware late-join projection.** Linear `projectBar` ignores repeats; alphaTab's tick/time timeline may allow an exact elapsed-time → position mapping. Investigate as a fast-follow only if late-join accuracy annoys in practice (spike notes in the technical design §Late joiners).
- [ ] **Promote playing tap-a-bar to a synced intent.** Needs a renderer-level user-interaction signal to distinguish a tap from a repeat jump (ADR-002 D2.1). Revisit with alphaTab's `beatMouseDown` events if the local-only acceptance chafes.
- [ ] Should the last band intent's author be surfaced anywhere beyond the song notice (e.g. "paused by Kate")? Deferred with presence UI (R4).

## Implementation Status

**Status:** Built — unit-tested and headlessly verified (build, dev server, no console errors); live two-device rehearsal verification (the manual e2e walk and iPad check) is still outstanding.
**Plan:** [docs/superpowers/plans/2026-07-05-playback-sync.md](../../superpowers/plans/2026-07-05-playback-sync.md)

## Changelog

| Date | Change | Reason |
|------|--------|--------|
| 2026-07-05 | Initial specification | Phase 3 of the M2 build sequence; implements ADR-002 D2 with 10 UX/architecture decisions (tempo stays on songSettings; scheduled follower starts; pause-as-resync; kind-tagged intents; approximate late join; picker-only song publishing; named switch notice; local Back; measured skew) |
| 2026-07-05 | Implemented (Tasks 1–8 of the plan) | Origin-tagged transport stamps, `session.transport`/`session.song` doc keys, the transport follower (LWW/echo/staleness guards + skew log), `applyRemote`/`dispose` on `localTransport`, follower wiring in `ChordChangesView`, and App.svelte's picker-only publishing + remote song follow + notice + skew console hook. Full test suite (151 tests), `svelte-check`, and `vite build` all green. Live two-device rehearsal walk and iPad check still pending (Task 9). |
| 2026-07-06 | Hardening pass: following and live-session publishing are **gated on band sync being on** (a generic `createIntentFollower` now backs both the transport and song followers); the sync opt-in **persists across reloads** (`createBandSession`, `bandaid.syncOn.v1` — iOS Safari tab reloads must not silently drop the band); session doc values are shape-validated on read; a tempo change no longer cancels a pending scheduled band start. | Sync-code review: stale IndexedDB stamps were applied at boot with sync off (playhead/song yanks on a local-only device), solo-practice stamps could yank the band on a later rejoin, and a bandmate's tempo write during another device's count-in stranded it paused. |
