# Feature: Chord-Changes-in-Time View

> Specification generated on 2026-06-26
> Part of: M1 (MVP) — the specific ~2-week learning deliverable
> Renderer: [ADR-001 alphaTab](../architecture-decisions/001-renderer.md)
> Renders over: [unified-music-model](unified-music-model.md)

## Overview

**Purpose:** Show a song's chord changes against a moving playhead so a solo player can drill *when the chords change* without the band present.

**User Story:** As the guitarist learning the rehearsal set, I want to load a song and watch a cursor sweep across the chord symbols in time (with optional sound), so I can internalize the chord *timing* by myself.

**Scope:** This feature is a **presentation template** — one local view over the unified music model and the session transport. It covers: rendering a song via alphaTab with chord symbols above a selectable instrument staff, alphaTab's built-in cursor as the playhead, an audio toggle (synth playback and/or metronome click), and writing transport changes to the session state object so the cursor is session-shaped from day one.

It explicitly does **NOT** include: a custom chord-lane/timeline visual (we use alphaTab's native render), a custom current/next-chord overlay (cursor only), the transport *controls* themselves (play/pause/tempo/seek live in the separate **local-transport** M1 feature — this view consumes them), looping (M2 fast-follow), multiplayer/join (M2), or any music processing (all upstream and offline per the unified-music-model boundary).

## Core Principle Link

Consistent with "no modes, only a session + local presentation templates": this is *a* template over the one shared playhead. A solo player is a session of one. The same view, unchanged, will run in a session of N once join lands — the only addition in M2 is that an incoming remote transport change seeks the local alphaTab player to the projected position.

## Design Decisions (from /design-feature conversation, 2026-06-26)

| # | Decision | Rationale |
|---|----------|-----------|
| D1 | **The view IS alphaTab's native render** — notation/tab staff with MusicXML `<harmony>` chord symbols above it, alphaTab's built-in cursor as the playhead. No separate custom timeline. | ADR-001: "chord symbols + moving cursor means the chord-changes view can BE alphaTab." Least code; chord layout/timing handled by alphaTab. |
| D2 | **Audio is toggleable: synth playback + metronome click**, chosen locally. | Solo drilling wants to *hear* the changes; a click lets you drill against a beat. Both are local-only presentation choices, never synced. |
| D3 | **Backing staff is selectable (local), default guitar tab.** | Player picks which part shows under the chords; defaults to the guitarist's instrument. Exercises the part-selection plumbing M3 templates need anyway. Falls back gracefully when a part is absent. |
| D4 | **Chord emphasis = alphaTab cursor only.** No custom active/next-chord overlay or banner in MVP. | Keep the MVP lean; timing is read from the cursor position over the chord symbols. A highlight/banner is a clean fast-follow if drilling proves it's wanted. |
| D5 | **alphaTab's player is the local time source.** Transport changes write a thin session object `{ startBar, startTimestamp, tempo }`. M2 join projects an incoming change to "now" and seeks the local player. | Least M1 code, audio "just works," and the session object exists from day one so join is additive, not a rewrite. Local "now" = alphaTab's clock (fine solo; M4 clock-sync gate tightens it only if measured drift is too loose). |

## User Flow

### Primary Flow (Happy Path)

```
User Action                         System Response
─────────────────────────────       ───────────────────────────────────────────
1. Open a song from library    →     Song's canonical MusicXML loads into alphaTab;
                                      chord symbols render above the default
                                      (guitar tab) staff. Cursor sits at bar 1.
2. (optional) Pick a part      →     alphaTab solos that part's staff under the
   / toggle audio                    chords; audio toggle sets synth and/or click.
3. Press play (transport)      →     alphaTab player advances; cursor sweeps across
                                      the chord symbols in time; audio plays per
                                      toggle. Transport state {startBar,
                                      startTimestamp, tempo} is stamped.
4. Slow the tempo / seek       →     alphaTab re-times; new {tempo}/{startBar,
   (transport)                       startTimestamp} stamped to session state.
5. Reach the end / pause       →     Cursor stops; playing=false stamped.
```

### Detailed Steps

1. **Load song into the view**
   - User: selects a song (from the library/set-list browsing feature).
   - System: hands the song's canonical MusicXML to alphaTab; reads content flags — offered only if `hasChords` is true. Renders chord symbols above the default backing staff.
   - UI: score/tab with chord symbols on top; cursor parked at the first sounding bar (respecting any pickup).

2. **Choose local presentation**
   - User: optionally switches backing part and toggles audio (synth / click / both / off).
   - System: alphaTab solos the chosen track; configures synth playback and/or a metronome click. These are local only — never written to session state.
   - UI: staff swaps; audio toggle reflects current choice.

3. **Drill (drive via local transport)**
   - User: play / pause / change tempo / seek — all provided by the separate **local-transport** feature.
   - System: alphaTab's player advances and emits beat/position callbacks; the cursor follows. On each transport change the view writes `{ playing, startBar, startTimestamp, tempo }` to the session state object.
   - UI: cursor sweeps across chord symbols in lockstep with audio; chord timing is read from cursor position.

## Requirements

### Functional Requirements

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-1 | Render a song via alphaTab showing chord symbols (from MusicXML `<harmony>`) above an instrument staff | Must |
| FR-2 | Drive alphaTab's built-in cursor as the playhead; cursor advances in time during playback | Must |
| FR-3 | Offer this template only when the song's `content.hasChords` is true | Must |
| FR-4 | Let the player select which part's staff backs the chords (local-only); default to guitar tab when present | Must |
| FR-5 | Toggle audio locally: synth playback of the arrangement and/or a metronome click; or silent | Must |
| FR-6 | On every transport change, write `{ playing, startBar, startTimestamp, tempo }` to the session state object | Must |
| FR-7 | Consume transport controls (play/pause/tempo/seek) from the separate local-transport feature; do not implement its own controls | Must |
| FR-8 | Gracefully degrade backing-part selection when a part is absent (e.g. OCR lead sheet with no tab) | Must |
| FR-9 | Cursor position is derived such that an M2 remote transport change can seek the local player to a projected position without changing this view's code | Should |
| FR-10 | Metronome click respects the song's tempo and meter (incl. mid-tune meter changes if present) | Should |

### Non-Functional Requirements

| ID | Requirement | Target |
|----|-------------|--------|
| NFR-1 | Cursor visually tracks audio without perceptible lag during solo playback | No human-noticeable cursor/audio skew at normal and slowed tempo |
| NFR-2 | Runs on iPhone, Android, iPad, and laptop (web) | All four; no per-device code paths for this view |
| NFR-3 | The solo practice loop works without a network dependency once assets are loaded | Load (incl. soundfont) may fetch; drilling loop itself is local |
| NFR-4 | Local presentation choices (part, audio, zoom, scroll) are never written to session state | Enforced by the local/synced split |
| NFR-5 | Soundfont/synth asset bundled or cached so audio playback is available cross-device | One bundled/cached soundfont sufficient for the set |

## Data Model

This view introduces no new canonical data. It reads the unified `Song` and writes only transport.

### Reads (from unified-music-model)

| Field | Use |
|-------|-----|
| `source.files.canonicalMusicXml` | Loaded directly into alphaTab |
| `content.hasChords` | Gates whether this template is offered |
| `parts[]` (instrument, notationType, musicXmlPartId) | Populates the backing-part selector; maps to alphaTab tracks |
| `defaultTempoBpm`, `timeSignature`, `hasPickup` | Cursor start (respecting pickup), metronome tempo/meter |

### Writes (session transport — the only synced state)

```typescript
// Thin session transport object. Exists in M1 (session of one);
// becomes multi-writer/last-write-wins in M2 with no shape change.
interface Transport {
  songId: string;
  playing: boolean;
  startBar: number;        // bar the playhead was at when this value was stamped
  startTimestamp: number;  // epoch ms when stamped
  tempo: number;           // bpm (local override of song default; per-device in M1)
}
```

### Local-only (never synced)

```typescript
interface ChordChangesViewLocalState {
  backingPartId: string;        // which Part.id is soloed under the chords
  audio: { synth: boolean; click: boolean };
  // plus alphaTab-owned zoom/scroll
}
```

## Interface (internal)

```typescript
interface ChordChangesView {
  // Mount alphaTab for a song; returns when render-ready.
  load(song: Song): Promise<void>;

  // Local presentation (never synced)
  selectBackingPart(partId: string): void;
  setAudio(opts: { synth: boolean; click: boolean }): void;

  // Transport is owned by the local-transport feature, which calls these.
  // This view reflects them into alphaTab and stamps session Transport.
  applyTransport(t: Transport): void;   // also used by M2 join to seek to projected position

  // Emitted upward so transport state can be stamped from alphaTab callbacks.
  onPositionChange(cb: (bar: number, ts: number) => void): void;
}
```

## Edge Cases & Error Handling

| Scenario | Expected Behavior |
|----------|-------------------|
| Song has no chords (`hasChords` false) | This template is not offered for that song |
| Song has no tab part (OCR lead sheet) | Backing-part selector hides tab options; defaults to the available notation/melody staff |
| Default "guitar tab" part absent | Fall back to the first available part (prefer a tab part, else melody/notation) |
| Song has a pickup (anacrusis) | Cursor starts at the documented pickup convention; `startBar` means the same as everywhere else |
| Mid-tune meter/key change | Rendered as-is by alphaTab; metronome click follows the active meter |
| Soundfont fails to load | Fall back to silent cursor (or click-only if click is independent of soundfont); surface a non-blocking notice; drilling still works |
| Tempo changed very low / scrubbing | Cursor stays attached to alphaTab playback; new `{startBar, startTimestamp, tempo}` stamped |
| Chord `<harmony>` lacks explicit offset | Onset comes from alphaTab's layout of `<harmony>` against note durations (per unified-music-model input standards) |

## Acceptance Criteria

- [ ] A real toolkit MusicXML song loads into alphaTab and shows chord symbols above a staff.
- [ ] Pressing play (via local-transport) sweeps alphaTab's cursor across the chords in time.
- [ ] Audio toggle works: synth playback, metronome click, both, and silent are all selectable locally.
- [ ] Backing part is switchable and defaults to guitar tab when present; absent parts degrade gracefully.
- [ ] A song with `hasChords=false` does not offer this template.
- [ ] Every transport change writes `{ playing, startBar, startTimestamp, tempo }` to the session object; no local presentation choice is ever written there.
- [ ] The view runs on iPhone, Android, iPad, and laptop (web) with no per-device code path.
- [ ] A simulated remote transport change can seek the local player to a projected position using `applyTransport` without modifying this view (proves M2-additive).

## Dependencies

### Depends On
- **alphaTab** (ADR-001): rendering, chord symbols, built-in cursor + beat callbacks, synth/soundfont.
- **unified-music-model**: the `Song` contract, content flags, and parts this view reads.
- **local-transport** (M1, separate spec): supplies play/pause/tempo/seek; this view reflects them and stamps session state.
- **session/state model** (M1): owns the `Transport` object this view writes.

### Depended On By
- **Join / shared state** (M2): adds multi-writer transport + projecting remote changes onto this view (additive).
- Future presentation templates reuse the same alphaTab mount + part-selection plumbing.

## Open Questions

- [ ] Soundfont choice/size for acceptable acoustic-ish playback across the 8-tune set (bundle vs cache).
- [x] Does alphaTab's metronome/click come free with its player? **Resolved (2026-06-28 spike):** yes — `api.metronomeVolume` (and `api.countInVolume`) are native, no custom click synth. Audio toggle will map to these volumes.
- [ ] Backing-part selector placement/UX (deferred to the browsing/shell UI spec).
- [ ] Confirm alphaTab cursor granularity is smooth enough at slowed tempo (note: this is also the M4 clock-sync reconsideration trigger from ADR-001).

## Implementation Status

**Status:** In Progress (view shell)
**Last Worked:** 2026-06-28
**Progress:** ~3/8 acceptance criteria (alphaTab render with chord symbols + cursor playhead; backing-part select with guitar-tab default; transport stamped to session via local-transport). Audio toggle UI, `hasChords` gating, and on-device test are fast-follows (the native metronome/synth volumes they map to already exist on the renderer).

### Implementation Notes
- The view IS alphaTab's native render (D1): `ChordChangesView.svelte` mounts the renderer, shows MusicXML `<harmony>` chords above a selectable staff, cursor as playhead.
- Transport is owned by **local-transport**, not this view: the view creates the `LocalTransport` controller and reflects play/seek; every change stamps `{playing,startBar,startTimestamp,tempo}` to the session store (FR-6).
- Audio toggle (FR-5) maps to the renderer's native `setMasterVolume`/`setMetronomeVolume` (spike-confirmed) — wiring deferred to the fast-follow.

### Files Created
- `src/views/ChordChangesView.svelte` — the view shell (renderer mount + part selector + transport controls).

## Changelog

| Date | Change | Reason |
|------|--------|--------|
| 2026-06-26 | Initial specification | Created via /design-feature; 5 design decisions captured (alphaTab-native view, toggleable audio, selectable backing part, cursor-only emphasis, alphaTab-player-as-clock with thin session state) |

---

_Last updated: 2026-06-26_
