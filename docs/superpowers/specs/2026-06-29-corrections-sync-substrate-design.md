# Design: Corrections sync substrate

Date: 2026-06-29
Status: Approved design — ready for implementation plan
Sub-project: A (this spec) of two. Sub-project B (the in-app corrections capture/review UX)
is specced separately and consumes this substrate.

## Context

The band wants to leave **corrections** on songs — a fiddler pins a note that needs a tie,
or marks that a section ought to repeat — and those notes get collected so the MusicXML can
be hand-edited later (in a Claude Code session) and redeployed. Corrections come from
different members, so they are inherently multi-device.

Today BandAid is a purely static SPA on GitHub Pages with **no backend and no accounts**.
State is local (`localStorage`, e.g. `bandaid.songSettings.v1`); the roadmap's M2 turns the
single-writer session store into a multi-writer CRDT *behind the same `SessionStore`
interface* ("no M1 code is thrown away to add join").

Corrections have a different sync profile than M2's headline live-playhead follow-along:
they are **async and must be durable** — a pin made solo at home has to survive and reach
the band even when no one else is online. That rules out a pure in-room P2P channel as the
*only* transport, and motivates a durable shared copy.

This spec designs the **sync substrate**: a CRDT document with layered, convergent
transports, carrying corrections as its first payload and ready to carry M2 session state
later. The in-app capture/review UX is out of scope here (sub-project B).

## Goals / Non-goals

**Goals**
- One shared, durable CRDT document per band, reachable from every member's device.
- Graceful layering: durable hosted copy + optional live P2P + offline export/import, all
  converging on the same document.
- A headless path to pull corrections into the repo as actionable JSON, and to write status
  back, closing the capture → edit-MusicXML → deploy loop.
- Preserve the existing `SessionStore` seam so current consumers are unchanged.

**Non-goals (this spec)**
- In-app pin capture and review UI (sub-project B).
- Live transport/playhead follow-along over the doc (a later M2 consumer of this substrate).
- Accounts / real auth. The band code is a shared secret, not authentication.
- A rich presence UI ("who's online" is explicitly deferred).

## Architecture

One **`Y.Doc` per band room** (Yjs CRDT), named by a shared **band code**. Transports are
*providers* bound to that one doc; because it is a CRDT, any subset running at once still
converges:

- **`y-indexeddb`** — always on. Local durability + instant offline load; the doc is fully
  usable with zero network.
- **PartyKit provider** (`y-partykit`) — the durable canonical copy. A ~10-line serverless
  party on Cloudflare with durable storage; holds state when you are the only one online.
  Required because GitHub Pages serves only static files and cannot run a sync server.
- **`y-webrtc`** — optional live P2P keyed by the same band code; low-latency in-room sync
  without a service round-trip. Best-effort (NAT can block it), so it is a bonus tier, not
  the reliable one.
- **Export / import** — `Y.encodeStateAsUpdate(doc)` → a file to send; `Y.applyUpdate` on
  import. The fully-offline tier and the in-app fallback to the headless pull.

The hosted provider sits behind a small **provider interface**, so swapping PartyKit for a
self-hosted `y-websocket`/Hocuspocus later is a one-file change.

## Document model & data shapes

Top-level maps in the `Y.Doc`:

- **`corrections`** — `Y.Map` keyed by UUID (concurrent add/edit/remove from different
  members merge cleanly). Each correction:

  ```ts
  interface Correction {
    id: string;            // uuid, stable across sync
    songId: string;
    anchor:
      | { kind: 'point'; bar: number; beat: number; voice?: number }
      | { kind: 'range'; startBar: number; endBar: number };
    category?: 'tie' | 'repeat' | 'wrong-note' | 'other'; // optional; free text ok
    text: string;          // the human note
    author: string;        // display name stamped at creation
    authorId: string;      // stable per-device id
    createdAt: number;     // epoch ms
    status: 'open' | 'applied' | 'dismissed';
    songVersion: string;   // build id / sha the pin was made against (staleness)
  }
  ```

- **`songSettings`** — `songId → { tempoPct?, transpose? }`, migrated out of the current
  `bandaid.songSettings.v1` localStorage into the doc on first run.
- **`session`** — reserved (empty in this spec) for the later transport/playhead consumer.

Anchors are bar/beat/voice (point) or a bar-range (for "repeat this section"); bars are
1-based, matching alphaTab's master-bar index + 1 and the MusicXML `<measure>` document
order. `songVersion` lets the app flag pins made against an older score as **stale** after a
correction is applied and the song is redeployed.

## Join, identity, presence

- **Band room** — the band code names the doc; PartyKit and `y-webrtc` key off it
  identically. Join by opening a link (`?band=<code>`) or entering the code once; it is
  remembered locally for auto-rejoin. Anyone with the code can read/write (shared secret,
  not auth) — acceptable for band corrections; documented as a known limitation.
- **Identity (no accounts)** — a per-device **display name**, **editable at any time**, plus
  a stable `authorId` (UUID persisted locally). A correction stamps `author` (the name at
  creation) and `authorId`; editing the name applies to future corrections and the presence
  label, and does not rewrite past corrections.
- **Presence** — Yjs **awareness** carries identity. A "who's online" display is **deferred**
  (low priority); v1 wires only what authorship needs. Awareness state is ephemeral, never
  persisted.

## Collection → resolution → deploy loop

1. **Capture** — members drop pins in-app (sub-project B); they sync to the PartyKit room.
2. **Pull** — `npm run corrections:pull -- <bandCode>`: a headless Node script connects to
   the room as a Yjs client, snapshots the `corrections` map, and writes
   `corrections/inbox.json` into the repo (open pins grouped by song, each with
   anchor/text/author/songVersion). The in-app "Export corrections" button produces the same
   JSON as an offline fallback.
3. **Resolve (Claude session)** — read `inbox.json`, step through each open correction,
   interpret it, and edit `public/songs/<songId>.musicxml` at the anchored bar/beat (or
   across the bar-range). Process a song's pins **bottom-up (highest bar first)** so an edit
   that adds/removes measures (e.g. a repeat) does not shift the bar numbers of pins not yet
   applied.
4. **Write-back** — `npm run corrections:resolve -- <ids>` flips those pins to
   `status: 'applied'` in the doc so the band sees "fixed". Stageable: v1 may rely on step 5.
5. **Ship** — commit the updated `.musicxml` and deploy via the existing flow; the per-build
   cache-bust re-fetches songs, and the new build id becomes the songs' `songVersion`, so any
   pin still `open` against an older version is flagged stale in the app.

The "step through and edit" workflow is naturally a future slash-command/skill over
`inbox.json` — no app code. The substrate's job is producing that JSON (pull + export) and
accepting status write-back.

## Store seam & migration

- **Seam** — `createSyncedSessionStore({ bandCode })` implements the *existing*
  `SessionStore` interface over the `Y.Doc`, extended with correction + identity +
  (minimal) presence methods. `App.svelte` swaps `createLocalSessionStore()` →
  `createSyncedSessionStore()` (one line). With no band code it degrades to local-only
  (IndexedDB, no network), so the app still works standalone.
- **Migration** — on first run, fold existing `bandaid.songSettings.v1` localStorage into the
  doc's `songSettings` map, once (guarded so it does not re-run).

## Testing

- **Unit (pure):** correction anchor shape + helpers, `songVersion` staleness check,
  `inbox.json` serialization from a doc snapshot, the migration transform.
- **Convergence:** two `Y.Doc`s exchanging updates through the store API converge to the same
  corrections set (Yjs guarantees the merge; the test covers our wrapper).
- **Pull script:** parses a doc snapshot → expected `inbox.json` shape.
- **Provider integration (PartyKit / WebRTC):** behind a mocked provider interface for unit
  tests; live connection verified manually / e2e.

## Risks & constraints

- **PartyKit free-tier limits** and a new external dependency the static app relies on when
  sharing. Mitigated by the provider interface (swap to self-hosted) and graceful local/P2P
  degradation.
- **Open band code** — shared-secret access, no auth. Acceptable for band corrections;
  documented.
- **WebRTC NAT flakiness** — P2P is the bonus tier; PartyKit is the reliable durable tier.
- **Anchor drift** — applying a range/repeat edit renumbers bars; mitigated by bottom-up
  edit order and re-pulling after deploy, with `songVersion` flagging stale pins.

## Scope boundary

**In scope:** the `Y.Doc` + layered providers + provider interface; corrections data shape;
join/band-code + editable identity + minimal awareness; `songSettings` migration; the
`createSyncedSessionStore` seam; `corrections:pull` / `corrections:resolve` scripts +
in-app export/import.

**Out of scope:** in-app pin capture/review UX (sub-project B); live transport/playhead sync
(later M2 consumer); accounts/auth; "who's online" presence display.

## Open questions

- PartyKit project naming / deploy ownership (whose Cloudflare account) and where the room
  endpoint URL is configured (build-time env vs in-app setting).
- Whether `corrections/inbox.json` is committed as an audit trail or kept as a gitignored
  working artifact.
- Whether `corrections:resolve` write-back ships in v1 or is deferred (relying on
  `songVersion` staleness alone initially).
