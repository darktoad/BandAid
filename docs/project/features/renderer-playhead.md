# Feature: Renderer + Local Playhead

> Specification generated on 2026-06-26
> Part of: M1 (MVP) — the foundation chord-changes-view and local-transport render over
> Renderer: [ADR-001 alphaTab](../architecture-decisions/001-renderer.md)
> Stack: Svelte + TypeScript + Vite (capture as ADR-003)
> Reads: [unified-music-model](unified-music-model.md) · Drives: [chord-changes-view](chord-changes-view.md), [local-transport](local-transport.md)

## Overview

**Purpose:** Provide the single alphaTab-backed renderer component, the local playhead, and the session/state store that every other M1 feature reads from and writes to.

**User Story:** As any band member, I want a song to render (notation + tab) with a playhead that moves locally on my device, so the chord-changes view and transport controls all act on one consistent renderer and one shared position.

**Scope:** This feature is the substrate. It covers: (1) a Svelte alphaTab **renderer component** that loads a song's canonical MusicXML, configures tracks, and renders notation + tab with local zoom; (2) the **local playhead** — alphaTab's player as the M1 time source, plus the pure `projectBar(transport, now)` function used to initialize position and (in M2) to seek to a peer's position; (3) the **session/state store** holding `{ currentSongId, transport }`, shaped so an M2 CRDT (Yjs) implementation drops in behind the same interface; (4) local **asset loading** (alphaTab fonts/worker + a bundled soundfont).

It explicitly does **NOT** include: the chord-symbol-specific view behavior (chord-changes-view), the transport *controls* (local-transport), library/set-list browsing (separate), multiplayer/networking (M2 — the store interface is built so it's additive), or any music processing (upstream/offline per unified-music-model).

## Core Principle Link

"No modes, only a session + local presentation templates." This feature builds the session itself (a session of one in M1) and the one renderer over which all templates sit. The synced/local split is enforced here: the store holds only `{ currentSongId, transport }`; zoom, scroll, instrument selection, and audio toggles live in the components, never in the store.

## Design Decisions (from /design-feature conversation, 2026-06-26)

| # | Decision | Rationale |
|---|----------|-----------|
| D1 | **Stack: Svelte + TypeScript + Vite.** Capture as ADR-003. | Lean runtime and low boilerplate for a small cross-platform web app; good mobile perf. alphaTab is a plain JS lib that mounts to a div, so framework-agnostic. |
| D2 | **Bundle alphaTab assets (fonts/worker) + a small soundfont locally** via Vite. | Supports the network-free solo practice loop (NFR); no per-device CDN dependency; aligns with eventual offline (ADR-001 deferred but not abandoned). |
| D3 | **One renderer component is the only code that touches alphaTab's API.** Everything else goes through this feature's interface. | Single integration point; swapping/upgrading alphaTab or its quirks stays contained. |
| D4 | **Session store holds `{ currentSongId, transport }` behind a small interface; M1 impl is a plain local Svelte store.** | Brief: "which song" + transport are the shared logical state. Interface boundary means the M2 Yjs/CRDT store drops in without touching consumers — join is additive. |
| D5 | **M1 playhead = alphaTab's player (local time source).** A pure `projectBar(transport, now)` function exists and is used to (a) position the cursor when loading a song that already has a transport, and (b) in M2, seek the local player to a remote peer's projected position. | Matches chord-changes-view D5 / local-transport D4. alphaTab advances + carries audio in M1; the projection is the reconciliation tool, not the M1 ticker. |

## User Flow

This feature is mostly infrastructure; the "user flow" is the load-and-render path other features trigger.

### Primary Flow (Happy Path)

```
Trigger                          System Response
──────────────────────────       ─────────────────────────────────────────────
1. App boots                 →    alphaTab assets (fonts/worker/soundfont) load
                                  from the local bundle; store initializes empty.
2. A song is selected        →    store sets currentSongId; renderer loads that
   (by browsing feature)          song's canonical MusicXML into alphaTab.
3. Render completes          →    notation + tab render; cursor placed at the
                                  song's start (or projectBar of an existing
                                  transport); render-ready event fires.
4. Transport/view act        →    local-transport drives the player; cursor
                                  advances; chord-changes-view reflects it. All
                                  read/write the same store.
```

### Detailed Steps

1. **Boot + asset load**
   - System: loads bundled alphaTab fonts/worker and the soundfont; constructs the renderer component (hidden until a song loads).
   - UI: app shell visible; renderer area shows an empty/loading state.

2. **Load a song**
   - Trigger: store's `currentSongId` changes (set by the browsing feature).
   - System: the renderer hands the song's `canonicalMusicXml` to alphaTab, applies track config (which parts exist), and renders notation + tab.
   - UI: the score appears with local zoom; cursor at the start bar (pickup-aware), or at `projectBar(transport, now)` if a transport already exists.

3. **Expose the playhead**
   - System: alphaTab's player provides position via beat callbacks; the renderer surfaces position upward and seeks the player when asked (used by local-transport and M2 join).
   - UI: cursor reflects the player's position.

## Requirements

### Functional Requirements

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-1 | A Svelte renderer component loads a song's canonical MusicXML into alphaTab and renders notation + tab | Must |
| FR-2 | alphaTab assets (fonts, worker) and a soundfont are bundled and load locally (no CDN) | Must |
| FR-3 | The renderer exposes the playhead: read current bar/position and seek to a bar | Must |
| FR-4 | A session store holds `{ currentSongId, transport }` and is the single source the other features read/write | Must |
| FR-5 | The store is defined behind an interface so an M2 CRDT (Yjs) implementation replaces the M1 local impl without changing consumers | Must |
| FR-6 | `projectBar(transport, now)` is a pure function used to initialize cursor position and (M2) to seek to a peer's position | Must |
| FR-7 | The renderer supports per-track solo/mute so a single part can back a view (used by chord-changes-view) | Must |
| FR-8 | Local zoom is supported and never written to the store | Should |
| FR-9 | Only this component touches alphaTab's API; consumers use this feature's interface | Should |
| FR-10 | Render-ready and load-error states are observable so consumers can gate controls | Must |

### Non-Functional Requirements

| ID | Requirement | Target |
|----|-------------|--------|
| NFR-1 | Solo practice loop runs without network once the app's assets are loaded | No runtime CDN/network dependency for render + playback |
| NFR-2 | Runs on iPhone, Android, iPad, laptop (web) | All four; one code path |
| NFR-3 | A song renders quickly enough to feel responsive on a phone | Render-ready within a couple seconds for a typical tune on mid-range mobile |
| NFR-4 | Synced/local split is structurally enforced | Store contains only `{ currentSongId, transport }`; presentation state lives in components |
| NFR-5 | alphaTab integration is contained | Replacing/upgrading alphaTab touches only this component |

## Data Model

### Session store (the synced state; local in M1, CRDT in M2)

```typescript
interface SessionState {
  currentSongId: string | null;
  transport: Transport;   // shape shared with local-transport / chord-changes-view
}

interface Transport {
  songId: string;
  playing: boolean;
  startBar: number;
  startTimestamp: number;  // epoch ms
  tempo: number;           // bpm
}

// The swap boundary. M1: in-memory Svelte store. M2: Yjs-backed, multi-writer.
interface SessionStore {
  subscribe(run: (s: SessionState) => void): () => void;
  setCurrentSong(songId: string): void;
  setTransport(t: Transport): void;     // local-transport is the writer
}
```

### Pure playhead projection

```typescript
// bar a transport has advanced to as of `now`. Used to init position and (M2) to seek.
function projectBar(t: Transport, now: number): number {
  if (!t.playing) return t.startBar;
  const beatsPerMs = t.tempo / 60 / 1000;
  // bars/beats conversion uses the song's meter; simplified here.
  return t.startBar + advanceBars(beatsPerMs * (now - t.startTimestamp));
}
```

### Renderer interface

```typescript
interface Renderer {
  load(song: Song): Promise<void>;     // hands canonicalMusicXml to alphaTab
  soloPart(partId: string): void;      // per-track solo/mute
  getPositionBar(): number;            // current cursor bar
  seekToBar(bar: number): void;        // used by local-transport and M2 join
  player(): AlphaTabPlayerHandle;      // play/pause/rate, surfaced to local-transport
  onReady(cb: () => void): void;
  onError(cb: (e: Error) => void): void;
  onPosition(cb: (bar: number, ts: number) => void): void;  // from beat callbacks
}
```

## Edge Cases & Error Handling

| Scenario | Expected Behavior |
|----------|-------------------|
| No song selected (empty store) | Renderer shows an empty state; no player; controls gated off |
| MusicXML fails to parse/load | `onError` fires; render area shows a non-blocking error; app stays usable to pick another song |
| Soundfont fails to load | Rendering still works; playback falls back to silent/click (per chord-changes-view); surface a notice |
| Song has fewer parts than expected (e.g. OCR, no tab) | Render available parts; `soloPart` falls back gracefully (handled with chord-changes-view) |
| Loading a song that already has a transport | Initialize cursor via `projectBar(transport, now)` rather than bar 1 |
| Pickup (anacrusis) present | Start bar honors the documented pickup convention so `startBar` means the same everywhere |
| Rapid song switches | Cancel/replace the in-flight load; last selection wins; no stale render |
| Mobile low memory / large score | Render lazily/paged if needed; never block the main thread (alphaTab worker) |

## Acceptance Criteria

- [ ] A real toolkit MusicXML song loads into the Svelte alphaTab component and renders notation + tab.
- [ ] alphaTab fonts/worker and a soundfont load from the local bundle with no network call.
- [ ] The renderer exposes current bar and can seek to a bar; the cursor reflects both.
- [ ] The session store holds `{ currentSongId, transport }` and is the only place those live; presentation state is not in it.
- [ ] The store sits behind `SessionStore` so a stub "fake remote writer" can drive it the way M2's CRDT will, without changing consumers.
- [ ] `projectBar(transport, now)` is unit-tested and used to initialize cursor position from an existing transport.
- [ ] Per-track solo works (a single part can back a view).
- [ ] Renders and plays on iPhone, Android, iPad, and laptop (web) with one code path.

## Dependencies

### Depends On
- **alphaTab** (ADR-001): rendering engine, player, per-track solo, beat callbacks, soundfont playback.
- **Svelte + TypeScript + Vite** (ADR-003 to capture): app shell + bundling of local assets.
- **unified-music-model**: the `Song` contract and `parts` this renders.

### Depended On By
- **chord-changes-view** (M1): renders over this component; reads the playhead.
- **local-transport** (M1): drives `player()`/`seekToBar` and writes `transport` to the store.
- **library/set-list browsing** (M1): sets `currentSongId`.
- **Join / shared state** (M2): replaces the M1 `SessionStore` impl with a CRDT-backed one; uses `projectBar` to seek to peers.

## Open Questions

- [ ] Capture the Svelte stack as **ADR-003** (parallel to pending ADR-002 sync-stack).
- [ ] Soundfont choice/size that sounds acceptable for the 8-tune set while staying small enough to bundle.
- [ ] Does alphaTab's worker/font bundling play cleanly with Vite's asset handling, or need a plugin/config?
- [ ] Exact bars↔beats conversion in `projectBar` for tunes with meter changes / pickups.
- [ ] Whether the M1 `SessionStore` should already use Yjs locally (no network) to de-risk M2, or stay a plain store and swap later.

## Implementation Status

**Status:** Not Started
**Last Worked:** -
**Progress:** 0/8 acceptance criteria

### Implementation Notes
_Notes will be added here as implementation progresses via `/impl-feature`._

### Files Created
_Tracked here as created._

## Changelog

| Date | Change | Reason |
|------|--------|--------|
| 2026-06-26 | Initial specification | Created via /design-feature; 5 design decisions (Svelte/TS/Vite stack, local-bundled assets, single alphaTab component, swappable session store, alphaTab-player-as-clock + projectBar reconciliation) |

---

_Last updated: 2026-06-26_
