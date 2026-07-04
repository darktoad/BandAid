# ADR-002: Sync Stack & Multi-User Ground Rules

> Status: Accepted
> Date: 2026-07-03
> Deciders: David, with Claude assistance
> Ratifies: D1–D5 from [multi-user-review-and-plan.md](../multi-user-review-and-plan.md) §6,
> plus the G2/G4 gap decisions from the same review.

## Context

M2 ("Join") turns the session of one into a session of N. The
[corrections-sync-substrate design](../../superpowers/specs/2026-06-29-corrections-sync-substrate-design.md)
(approved 2026-06-29) de-facto chose the sync stack, but no ADR captured it, and the
2026-07-02 multi-user review found two semantic gaps (transport conflict resolution, the
offline-join story) that were asserted in the roadmap without being designed. This ADR
writes all of it down before Phase 1 implementation starts.

One input changed between the spec and this ADR: **PartyKit was acquired by Cloudflare**
(April 2024). The `partykit.io` platform and the `y-partykit` package the spec named are
now legacy; the actively maintained successor is **PartyServer** (`partyserver` +
`y-partyserver`, still releasing as of mid-2026 — check the current version at
implementation time), which runs as a Durable Object on the band's own Cloudflare
account and is deployed with `wrangler`. Same architecture — a ~10-line Yjs relay party
with durable per-room storage — different package and deploy path. This is exactly the
swap the provider interface was designed to absorb.

## Decisions

### D1 — Sync stack

**Yjs** (`yjs`) is the CRDT substrate. One `Y.Doc` per band code carries
`corrections` / `songSettings` / `session` maps. Transports are layered *providers*
bound to that one doc, all convergent, any subset sufficient:

| Tier | Package | Role |
|---|---|---|
| Local durability | `y-indexeddb` | Always on; offline load; the doc works with zero network |
| Durable hosted | **`y-partyserver`** (Cloudflare Durable Object) | The canonical copy; holds state when nobody else is online |
| Live P2P | `y-webrtc` | Bonus low-latency tier; best-effort (NAT/signaling flakiness accepted) |
| Floor | `Y.encodeStateAsUpdate` export/import | Fully-offline file exchange |

All hosted access goes through the `SyncProvider` interface so a future swap
(self-hosted `y-websocket`, Hocuspocus, or whatever succeeds PartyServer) is a one-file
change. The implementation plan's Tasks 5–8 originally named `y-partykit` /
`partykit.json` / `VITE_PARTYKIT_HOST` / `*.partykit.dev`; they were amended in place on
2026-07-03 (YProvider from `y-partyserver/provider`; a `YServer` Durable Object deployed
with `wrangler`).

### D2 — Transport conflict rule (G2), and which stamps sync at all

The roadmap's "multi-writer, last-write-wins by timestamp" is now defined precisely:

1. **Intent stamps vs anchor stamps.** Since PR #28, `localTransport` stamps in two
   distinct situations:
   - **Intent** — a user action: play, pause, seek (including paused tap-a-bar), tempo
     change. These express "the band should be here" and **are written to the shared doc**.
   - **Anchor** — a mechanical re-anchor when the local cursor moves non-sequentially
     during playback (repeat barlines, volta skips). Every device's own renderer hits the
     same jumps itself, so these are **local-only projection corrections and are never
     written to the shared doc**. Sharing them would mean N devices writing
     near-identical stamps at every repeat, injecting each device's clock skew into the
     others' projections for zero information gain.
   The transport layer must therefore tag (or route) stamps by origin; "swap the store"
   alone does not capture this. One known seam gap: alphaTab's click-to-seek is active
   during playback too, and a playing tap reaches the transport only through
   `onPosition`, indistinguishable from a repeat jump — so under this rule it stays
   **local-only in v1**. The Phase 3 spec must either surface a renderer-level
   user-interaction signal to promote it to intent, or explicitly keep that acceptance.
2. **Apply rule for remote intent stamps.** Last-press-wins needs a *press time*, and
   `startTimestamp` is not one: it is a projection anchor that `play()` deliberately
   stamps up to a bar in the **future** to hold position through the local count-in
   (`localTransport.ts`). Comparing `startTimestamp` would silently drop a bandmate's
   pause pressed during someone's count-in window. So: intent writes carry a dedicated
   wall-clock **`issuedAt`** (the moment the user acted); on receive, apply the stamp
   iff its `issuedAt` is newer than that of the **last applied intent stamp** — never
   compared against local anchor re-anchors, which refresh at every repeat barline and
   would otherwise reject nearly everything mid-tune. Yjs map resolution (causality +
   client id, not wall-clock) remains the storage-level tiebreak; `startTimestamp`
   stays purely the projection anchor.
3. **Echo guard.** Writes carry the writer's `authorId`; the apply layer ignores state
   it wrote itself.
4. **Clamping is local and silent.** Tempo (and any future bounded setting) is clamped
   on apply (`maxTempoPercent`, PR #33) but the clamped value is **not written back** to
   the doc — write-back would ping-pong between devices whose charts disagree.

### D3 — Offline-join posture (G4)

**v1 requires internet to *join*; in-room traffic degrades gracefully afterwards.**
PartyServer needs the internet; y-webrtc needs a signaling server to introduce peers.
The vision's "works offline in the same room" is honestly met at the practice level
(the doc is fully usable solo-offline via IndexedDB, and export/import is the floor)
but *joining a live session* needs connectivity in v1. Revisit LAN signaling only if a
real rehearsal space bites; do not build it speculatively.

### D4 — Deploy ownership & configuration

The PartyServer worker deploys to **David's Cloudflare account** via `wrangler deploy`
(a manual operator step, not CI). The client reads the host from a build-time env var —
**`VITE_SYNC_HOST`** (renamed from the plan's `VITE_PARTYKIT_HOST`, since the host is
now a `*.workers.dev` URL). Unset ⇒ the hosted tier simply isn't attached; local +
export tiers still work.

### D5 — `corrections/inbox.json` is a working artifact

Gitignored, not committed. The audit trail is the resolved pins in the doc itself
(`status: 'applied'` + `songVersion` staleness), not a JSON file in git history.

## What is shared vs local (restated, verified against code 2026-07-03)

Shared (the doc): `corrections`, `songSettings` (`tempoPct`, `transpose`), and in Phase 3
`session` (`currentSongId`, intent Transport, later set-list position).

Local (never synced, enumerated so nobody "helpfully" migrates them):
`bandaid.volume`, `bandaid.chordOverlay`, `bandaid.showMasthead`, `bandaid.lastSong.v1`,
`bandaid.lastList`, count-in preference, zoom/scroll/template/instrument selection.
Only `bandaid.songSettings.v1` migrates into the doc (once, guarded).

## Consequences

- Phase 1 (corrections substrate) can start immediately; the plan amendment covers the
  PartyServer swap.
- The Phase 3 spec must design the intent/anchor tagging into the transport seam
  (a `stamp()` origin flag or two write paths) — noted in the review addendum.
- The band accepts internet-to-join; the vision doc now references this ADR instead of
  implying offline join.
- Platform risk shifts from "small startup" to "Cloudflare product surface" — strictly
  better, and still fenced behind the provider interface.
