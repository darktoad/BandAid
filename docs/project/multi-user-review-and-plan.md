# Multi-User (M2 "Join") — Review & Plan

> Date: 2026-07-02 · Status: Review of existing design + proposed build sequence
> Inputs: [vision.md](vision.md), [roadmap.md](roadmap.md),
> [corrections-sync-substrate design](../superpowers/specs/2026-06-29-corrections-sync-substrate-design.md) (approved),
> [corrections-sync-substrate plan](../superpowers/plans/2026-06-29-corrections-sync-substrate.md) (written, 0/8 tasks executed),
> M1 codebase as of PR #20, and the 2026-07-02 QA report (`.gstack/qa-reports/`).

## Executive summary

The multi-user foundation is in better shape than most projects at this stage: the
"no modes, only sessions" principle held through M1, the `SessionStore` seam is real,
and the corrections-sync design is approved with a complete task-by-task implementation
plan that has simply not been executed yet. The right move is to **run the existing
corrections-substrate plan as Phase 1** — it derisks every M2 building block (CRDT doc,
band code, providers, identity) on an async, low-stakes payload before any live-playhead
work.

The review found **four genuine gaps** that the "swap the store implementation" story
glosses over. The biggest: **nothing in the app consumes state changes today.** All
production code writes into the store; only tests subscribe. Multi-user is not just a
new store — it is teaching the view/transport layer to *follow* remote changes
(transport, song switches, key/tempo). That follower path is new code and should be
planned as its own phase, not discovered mid-swap.

## 1. What "multi-user" means for BandAid (from the vision)

- **A session of N, not a host + guests.** Join is additive; a session of one and of
  five run the same code. No host migration because no one is the clock.
- **Shared: tiny logical state.** `currentSongId`, transport `{startBar,
  startTimestamp, tempo}`, per-song key/tempo overrides, set list position, and (new)
  corrections. **Local: everything visual** — zoom, scroll, template, overlay,
  instrument, audio toggles.
- **Loose follow-along first.** Each device projects the playhead locally from the
  stamp; modest drift is accepted. NTP-style tightening is M4, gated on measurement.
- **No accounts.** Band code as shared secret; per-device display name + stable id.
- **Same-room and offline-friendly**, but corrections must be durable across time
  (solo pin at home → band sees it later), which forces a hosted durable copy.

## 2. What exists today

### Design assets

| Asset | State | Notes |
|---|---|---|
| Vision + roadmap M2 definition | Done | Join, shared state, presence, late-joiner transfer, shared set list |
| Corrections-sync substrate **design** | **Approved** | Y.Doc per band code; y-indexeddb + PartyKit + y-webrtc + export/import; identity; migration |
| Corrections-sync substrate **implementation plan** | **Written, not started** (0/8 tasks checked) | TDD task-by-task, file structure, self-reviewed against spec |
| Sub-project B (in-app pin capture/review UX) | Spec referenced, **not written** | Consumes the substrate |
| ADR-002 (sync stack) | **Never captured** | The corrections spec de-facto decides it (Yjs + PartyKit + y-webrtc) |

### Code seams (verified in source, 2026-07-02)

| Seam | Ready? | Evidence |
|---|---|---|
| `SessionStore` interface | ✅ | `src/session/types.ts` — the swap boundary is explicit and narrow (7 methods) |
| Single Transport writer | ✅ | `localTransport.ts` is the sole `setTransport` caller; stamps are projection-shaped |
| Local playhead projection | ✅ | `projectBar()` reconciles `{startBar, startTimestamp, tempo}` → fractional bar |
| One-line store swap | ✅ | `App.svelte:11` — `createLocalSessionStore()` → `createSyncedSessionStore()` |
| Per-song overrides shape | ✅ | `SongSettings {tempoPct?, transpose?}` — optional fields, reset = clear, CRDT-friendly |
| **Follower path (remote → UI)** | ❌ | **No production code subscribes to the store.** Writes are fire-and-forget; remote changes would be invisible |
| **Remote song switch** | ❌ | `App.svelte` keeps `current` as local `$state`; a peer's `currentSongId` write wouldn't load the song |
| **Remote transport apply** | ❌ | `ChordChangesView` treats local controls as the only source; nothing seeks/plays alphaTab from a store change |
| URL / deep links | ❌ | No routing at all (QA ISSUE-004); join links (`?band=`) need the same plumbing as song links (`?song=`) |

## 3. Review findings

### Strengths (keep doing this)

1. **The store seam held.** M1 discipline paid off — the interface is small, tested, and
   documented as the swap boundary. The corrections plan preserves it exactly.
2. **Corrections-first is the right first slice.** Async + durable + low-stakes: it
   proves band code, providers, identity, convergence, and the headless repo loop
   without touching the time-sensitive playhead. If PartyKit or WebRTC disappoint, you
   find out on pins, not mid-rehearsal.
3. **Layered transports with graceful degradation** (local IndexedDB always; hosted
   durable; P2P bonus; file export floor) matches the "offline-capable" constraint
   honestly instead of pretending P2P alone can be durable.
4. **The stamp-projection transport model eliminates host migration by construction** —
   the hardest distributed-systems problem in the space is simply designed out.

### Gaps (plan work for these)

5. **G1 — The follower direction doesn't exist.** Everything today is UI → store.
   M2 needs store → UI: apply a remote Transport (seek/play/pause/tempo the local
   alphaTab), react to `currentSongId` (load the song), apply remote
   `songSettings` (re-run transpose/tempo, which after PR #20 also re-renders chords).
   Recommendation: build this as an explicit **"remote apply" layer** with an
   *echo guard* (ignore state you just wrote; `authorId`/origin tagging on writes), and
   build it against the *local* store first — it is testable in a session of one by
   replaying stamped states.
6. **G2 — LWW semantics are asserted, not designed.** The roadmap says multi-writer
   transport is "last-write-wins by timestamp," but Yjs map writes resolve by CRDT
   causality + client id, **not wall-clock**. Two peers hitting Play within the same
   second can converge on the *earlier* press. Decide explicitly: either accept Yjs's
   resolution (simplest, fine for a 3–5 person band) or store the stamp and compare
   `startTimestamp` on apply (rejecting older-than-current). One paragraph in the M2
   spec, but it must be written down.
7. **G3 — Clock skew becomes playhead offset.** `startTimestamp` is `Date.now()` on the
   writer's device; every follower projects with its own clock. Phones NTP-sync at the
   OS level so skew is usually well under ~200 ms, but nobody has measured the band's
   actual devices. Cheap insurance: log `(receivedAt - startTimestamp)` skew samples
   during Phase 3 dogfooding — that number *is* the M4 gate evidence.
8. **G4 — Same-room-offline vs the chosen stack.** PartyKit requires internet;
   y-webrtc needs a signaling server to introduce peers (the public community servers
   are unreliable); so the honest v1 join story is "internet required to connect,
   direct afterwards." That contradicts the vision's "works offline in the same room"
   aspiration. Options: (a) accept internet-to-join for v1 and document it (recommended
   — rehearsal spaces with zero connectivity are rare and the export/import floor
   exists), or (b) later run signaling on a LAN box. Capture the choice in ADR-002
   rather than leaving the vision text implying otherwise.

### Risks

9. **R1 — PartyKit platform risk.** Small external dependency, Cloudflare-acquired;
   verify `y-partykit` maintenance status at implementation time. Mitigated by the
   provider interface (swap to self-hosted y-websocket/Hocuspocus is one file).
10. **R2 — iOS Safari quirks** for IndexedDB persistence eviction and WebRTC in
    long-lived tabs. The fiddle player is the least tech-savvy user and most likely on
    an iPad; make her device the primary test target for Phase 1.
11. **R3 — Anchor drift on corrections** when an applied edit renumbers bars. The spec
    already mitigates (bottom-up application, `songVersion` staleness); keep it.
12. **R4 — Scope creep into presence UI.** The spec rightly defers "who's online."
    Hold that line through Phase 3; a name label on corrections is enough social proof.

## 4. Recommended build sequence

Each phase lands as one or more PRs into `main` (existing workflow), independently
shippable, with the app fully usable at every step.

### Phase 0 — Runway (small, do now)
- Merge PR #20 (transpose/tempo) after the ear check.
- Fix QA highs that intersect M2: **ISSUE-001** (lyric clipping), and **ISSUE-004**
  minimally as `?song=<id>` deep-linking — the same URL plumbing that `?band=<code>`
  join links need. Skip full routing; query params suffice.
- Capture **ADR-002 (sync stack)** and the **G2/G4 decisions** formally (one page).

### Phase 1 — Corrections sync substrate (the existing plan, as written)
- Execute `docs/superpowers/plans/2026-06-29-corrections-sync-substrate.md` tasks 1–8:
  types/helpers → identity → Y.Doc + migration → synced store (local mode) → provider
  interface + wrappers → app wiring with `?band=` → PartyKit server + deploy →
  pull/resolve scripts.
- Exit criteria: two devices with the same band code converge on corrections and
  songSettings; solo-offline still works with no band code; `corrections:pull` writes
  `inbox.json` in the repo.
- Estimate: the plan is TDD-granular (human: ~1–2 weeks / CC: ~1–2 sessions).

### Phase 2 — Corrections capture/review UX (sub-project B; needs its spec first)
- Long-press/tap-a-bar → pin composer (bar/beat prefilled); corrections list per song
  with status; stale badge via `songVersion`; export/import buttons.
- This also dogfoods identity (display name prompt on first pin).
- Exit criteria: the fiddler pins "needs a tie" at home; it appears in the repo inbox;
  after redeploy her pin shows "applied."

### Phase 3 — Live session state (M2 core)
Ordered inside the phase by risk:
1. **Remote apply layer (G1) against the local store** — replayable, unit-tested.
2. **Shared `songSettings` + `currentSongId`** over the doc (slow-moving state, easy
   to verify: bandmate changes key → your sheet re-renders in the new key).
3. **Multi-writer Transport** with the G2 rule + echo guard; loose follow-along.
4. **Skew/drift measurement (G3)** logged during real rehearsal use.
- Presence stays: awareness wired, no UI beyond correction authorship.
- Exit criteria: two devices, one presses Play, the other's playhead follows within
  the loose tolerance; either device can pause/seek/change tempo; a mid-song joiner
  lands on the right song at roughly the right bar.

### Phase 4 — Shared set list + M4 gate review
- Shared set-list position ("what are we playing next") — trivially a doc field once
  Phase 3 exists.
- Review drift numbers from Phase 3; only then decide whether NTP-style sync (M4) is
  needed at all.

## 5. Test strategy (delta over the plan's own testing section)

- **Convergence property tests** already planned (two docs exchanging updates).
- Add **remote-apply unit tests**: given a stored Transport stamped by "another
  device," the transport layer issues the right renderer calls (seek/play/speed) and
  ignores its own echoes — fully testable with the existing fake-renderer pattern.
- Add a **two-browser-context e2e smoke** (manual or scripted) per phase exit.
- Keep the session-of-one regression suite green throughout: no band code ⇒ behavior
  identical to today (this is the "no modes" invariant, and it is cheap to assert).

## 6. Decisions to capture before Phase 1 starts

| # | Decision | Recommendation |
|---|---|---|
| D1 | ADR-002 sync stack | Ratify the spec's choice: Yjs + y-indexeddb + PartyKit + y-webrtc, behind the provider interface |
| D2 | Transport conflict rule (G2) | Compare `startTimestamp` on apply; ignore stamps older than the locally-applied one |
| D3 | Offline-join posture (G4) | v1: internet required to *join*; document; revisit LAN signaling only if it bites |
| D4 | PartyKit deploy ownership | David's Cloudflare account; host URL via `VITE_PARTYKIT_HOST` build env (per plan Task 6) |
| D5 | `inbox.json` in git? | Gitignore it (plan already does); the audit trail is the resolved pins in the doc |
