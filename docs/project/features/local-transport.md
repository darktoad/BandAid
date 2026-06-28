# Feature: Local Transport

> Specification generated on 2026-06-26
> Part of: M1 (MVP) — the controls that drive the playhead
> Renderer: [ADR-001 alphaTab](../architecture-decisions/001-renderer.md)
> Drives: [chord-changes-view](chord-changes-view.md) · Reads: [unified-music-model](unified-music-model.md)

## Overview

**Purpose:** Give a solo player play/pause, tempo, and manual seek over the current song, driving alphaTab's player and stamping the session transport state so the cursor is session-shaped from day one.

**User Story:** As the guitarist drilling a song, I want to play, slow it down, count myself in, and jump to a specific bar, so I can work a hard passage at my own pace.

**Scope:** This feature owns the transport *controls* and the writes to the shared `Transport` object. It covers: play/pause, tempo (shown as both BPM and % of original), manual seek by tapping a bar **and** by a scrubber, and a toggleable one-bar count-in. It is the only place that writes `{ playing, startBar, startTimestamp, tempo }`.

It explicitly does **NOT** include: the rendering/cursor itself (that's the renderer + chord-changes-view via alphaTab), **looping / loop in-out** (M2 fast-follow per the roadmap), multiplayer/multi-writer transport (M2 — this feature is built so that becomes additive), set-list navigation (separate browsing feature), or persistence of per-song tempo choices (storage is post-MVP).

## Core Principle Link

"No modes, only a session + local presentation templates." Transport is the small logical state the session shares. In M1 it's a session of one, so the writes are local; in M2 the same `Transport` object becomes multi-writer (last-write-wins by timestamp) and any peer can stamp tempo/play/seek for everyone — no change to this feature's shape. The cursor is never synced; only these values are.

## Design Decisions (from /design-feature conversation, 2026-06-26)

| # | Decision | Rationale |
|---|----------|-----------|
| D1 | **Tempo is shown as both BPM and % of original**, range ~50–110%. | Practice thinks in "play it at 70%"; BPM gives the absolute. alphaTab's synth changes playback rate, so pitch is preserved automatically (no time-stretch artifacts). |
| D2 | **Seek by both tapping a bar in the score and a scrubber.** | Tap-a-bar is precise and musical ("jump to the B"); the scrubber is fast travel. alphaTab supports beat clicks; the scrubber maps position↔bar. |
| D3 | **Toggleable one-bar count-in, default on.** | A driller wants a beat to get ready; reuses the metronome click from chord-changes-view. The toggle is a local presentation choice. |
| D4 | **This feature is the sole writer of the `Transport` object.** alphaTab's player is the local time source; controls drive it and stamp `{playing, startBar, startTimestamp, tempo}`. | Matches chord-changes-view D5. Keeps the synced/local split clean and makes M2 multi-writer additive. |
| D5 | **Looping is out (M2).** Manual seek is the accepted M1 floor for "work a passage." | Roadmap: "Manual seek is the accepted floor; looping is a fast-follow." |

## User Flow

### Primary Flow (Happy Path)

```
User Action                     System Response
──────────────────────────      ─────────────────────────────────────────────
1. Press play                →   (if count-in on) one bar of click, then
                                 alphaTab player starts; stamp {playing:true,
                                 startBar:current, startTimestamp:now, tempo}.
2. Drag tempo to 70%         →   alphaTab playback rate set to 0.70; display
                                 shows "70% · 84 bpm"; restamp {startBar:current,
                                 startTimestamp:now, tempo:newBpm}.
3. Tap bar 9 (the B part)    →   cursor + player jump to bar 9; restamp
   OR drag the scrubber          {startBar:9, startTimestamp:now}; playing state
                                 preserved.
4. Press pause               →   player stops; stamp {playing:false} at the
                                 current bar.
```

### Detailed Steps

1. **Play / pause**
   - User: taps play (or spacebar on laptop).
   - System: if count-in is on, plays one bar of click at the current tempo/meter, then starts alphaTab's player; stamps `playing:true` with current bar and now. Pause stops the player and stamps `playing:false`.
   - UI: play/pause button toggles; cursor begins/halts its sweep.

2. **Tempo**
   - User: drags a tempo control (or steppers) between ~50% and ~110%.
   - System: sets alphaTab playback rate; recomputes BPM from the song default; if playing, restamps `{startBar:current, startTimestamp:now, tempo}` so position stays continuous.
   - UI: shows both "% of original" and resulting BPM; metronome/count-in follow the new tempo.

3. **Seek (tap-a-bar or scrubber)**
   - User: taps a bar/chord in the alphaTab render, or drags the scrubber.
   - System: moves alphaTab's player/cursor to that bar; restamps `startBar` + `startTimestamp`; keeps current `playing` state.
   - UI: cursor jumps; scrubber position reflects the bar (and vice-versa).

4. **Count-in toggle**
   - User: flips count-in on/off (local preference).
   - System: stores the toggle locally; next play either pre-rolls one bar of click or starts immediately.
   - UI: a small count-in toggle; never written to session state.

## Requirements

### Functional Requirements

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-1 | Play and pause drive alphaTab's player and stamp `playing` (+ current bar/now) to the `Transport` object | Must |
| FR-2 | Tempo control adjusts playback rate, shown as both % of original and BPM, over ~50–110% | Must |
| FR-3 | Changing tempo while playing keeps the cursor position continuous (restamp startBar/startTimestamp) | Must |
| FR-4 | Seek by tapping a bar in the score moves the cursor/player to that bar and restamps | Must |
| FR-5 | Seek by dragging a scrubber moves to the mapped bar and restamps; scrubber stays in sync with the cursor | Must |
| FR-6 | A one-bar count-in, toggleable (default on), plays a click at current tempo/meter before playback starts | Must |
| FR-7 | This feature is the only writer of `{ playing, startBar, startTimestamp, tempo }` | Must |
| FR-8 | Tempo change preserves pitch (rely on alphaTab synth playback rate, not audio time-stretch) | Must |
| FR-9 | Count-in on/off and any tempo-control UI state that is presentation-only are local; never written to session state | Must |
| FR-10 | Built so M2 can make `Transport` multi-writer (last-write-wins by timestamp) without changing these controls | Should |
| FR-11 | Laptop keyboard shortcut for play/pause (spacebar); large tap targets on mobile | Should |

### Non-Functional Requirements

| ID | Requirement | Target |
|----|-------------|--------|
| NFR-1 | Transport actions feel immediate | No human-noticeable lag between control and cursor/audio response |
| NFR-2 | Runs on iPhone, Android, iPad, laptop (web) | All four; no per-device code path |
| NFR-3 | Practice loop works without network once assets are loaded | Controls + stamping are fully local |
| NFR-4 | Tempo/seek restamps never accumulate drift in computed position | Position after a restamp equals the bar the user was on |

## Data Model

No new canonical data. Writes the shared transport; reads song defaults.

### Reads (from unified-music-model)

| Field | Use |
|-------|-----|
| `defaultTempoBpm` | Basis for the "% of original" ↔ BPM mapping |
| `timeSignature`, `hasPickup` | Count-in length/meter; seek/scrubber bar mapping; pickup-aware start |
| `measureCount` | Scrubber range (bars) and end-of-song handling |

### Writes (the shared transport — same object chord-changes-view consumes)

```typescript
interface Transport {
  songId: string;
  playing: boolean;
  startBar: number;        // bar the playhead was at when stamped
  startTimestamp: number;  // epoch ms when stamped
  tempo: number;           // bpm (derived from default × percentage); per-device in M1
}
```

### Local-only (never synced)

```typescript
interface LocalTransportPrefs {
  countIn: boolean;        // default true
  // tempo percentage is reflected into Transport.tempo (bpm); the % display is derived
}
```

## Interface (internal)

```typescript
interface LocalTransport {
  play(): void;            // honors count-in; stamps playing:true
  pause(): void;           // stamps playing:false
  setTempoPercent(pct: number): void;  // ~0.5–1.1; maps to bpm, restamps if playing
  seekToBar(bar: number): void;        // from tap-a-bar or scrubber; restamps
  setCountIn(on: boolean): void;       // local pref

  // Current snapshot for the renderer/scrubber to reflect.
  getTransport(): Transport;
  onTransportChange(cb: (t: Transport) => void): void;
}
```

## Edge Cases & Error Handling

| Scenario | Expected Behavior |
|----------|-------------------|
| Seek/play before song fully loaded | Controls disabled (or queued) until alphaTab is render-ready |
| Tempo dragged to the min/max | Clamp to the allowed range; never 0 or negative |
| Seek past the last bar | Clamp to the final bar; pause at end |
| Count-in on, but audio is fully muted in chord-changes-view | Count-in still provides a visual/beat cue, or is skipped gracefully if no click source — surface nothing blocking |
| Pickup (anacrusis) present | `startBar` and count-in respect the documented pickup convention so the bar means the same everywhere |
| Mid-tune meter change | Count-in and scrubber bar-mapping follow the active meter |
| Tempo changed while paused | Update rate + display; restamp tempo (and start values on next play) |
| Rapid repeated seeks/tempo drags | Each produces a clean restamp; last write wins; no position drift |
| (M2 preview) remote transport change arrives | Project to "now" and seek the local player; local count-in is NOT imposed when following a remote start |

## Acceptance Criteria

- [ ] Play starts alphaTab's player and stamps `playing:true` with the correct current bar and timestamp; pause stamps `playing:false`.
- [ ] Tempo control shows both % and BPM, adjusts playback rate across ~50–110%, and preserves pitch.
- [ ] Changing tempo mid-playback keeps the cursor position continuous (no jump).
- [ ] Tapping a bar in the score seeks there and restamps; the scrubber does the same and stays in sync with the cursor.
- [ ] A toggleable one-bar count-in (default on) plays a click at the current tempo/meter before playback.
- [ ] Only this feature writes the `Transport` object; count-in toggle and %-display state are never written to session state.
- [ ] All controls work on iPhone, Android, iPad, and laptop (web); spacebar toggles play/pause on laptop.
- [ ] A simulated remote transport change can seek the local player via the same path without changing these controls (proves M2-additive).

## Dependencies

### Depends On
- **alphaTab** (ADR-001): player (rate, play/pause, seek-to-beat), beat callbacks, click/metronome source.
- **unified-music-model**: song defaults (tempo, meter, pickup, measure count).
- **session/state model** (M1): owns the `Transport` object this feature writes.

### Depended On By
- **chord-changes-view** (M1): reflects transport into the cursor and reads/stamps the same `Transport`.
- **Join / shared state** (M2): makes `Transport` multi-writer; reuses these controls unchanged.

## Open Questions

- [x] Does alphaTab expose a count-in/metronome directly, or do we build a one-bar click from beat callbacks? **Resolved (2026-06-28 spike):** alphaTab has both natively — `api.countInVolume` (one-bar pre-roll) and `api.metronomeVolume` (in-playback click), each 0–1, default 0/off. No custom click synth needed. Surfaced on the renderer as `setCountInVolume` / `setMetronomeVolume`.
- [x] Exact tempo range and step granularity. **Decided:** 50–110% in 5% steps (range clamped in `createLocalTransport`; UI slider step 5).
- [x] Scrubber granularity: snap to bar vs free scrub then snap on release. **Decided:** snap-to-bar (integer `step=1` over `[1, measureCount]`); drives the same seek/restamp path as tap-a-bar.
- [ ] Should the last-used tempo per song persist? (Tied to post-MVP storage.)
- [ ] Control layout/placement (deferred to the shell/browsing UI spec).

## Implementation Status

**Status:** In Progress
**Last Worked:** 2026-06-28
**Progress:** ~5/8 acceptance criteria (play/pause stamp; tempo %↔BPM + continuity; tap-a-bar **and scrubber** seek via store; sole-writer guarantee). Count-in UI toggle and on-device test remain.

### Implementation Notes
- `createLocalTransport` is the **sole writer** of `Transport` (FR-7). It stamps the *intended* next state immediately rather than reading post-callback state, fixing the stale-stamp bug in the old inline App demo.
- **Continuity (FR-3):** tempo change and seek restamp `{startBar:currentBar, startTimestamp:now}` so `projectBar` sees no jump — unit-tested against the real `projectBar`.
- **Tap-a-bar (D2):** alphaTab's native click-to-seek (`enableUserInteraction`) is wired through the store by treating a position change *while paused* as a seek stamp.
- **Pitch preserved (FR-8):** tempo is alphaTab playback rate (`setSpeed`), not audio time-stretch.
- Count-in/metronome use the native alphaTab volumes from the spike (renderer `setCountInVolume`/`setMetronomeVolume`); the toggle UI is a fast-follow.
- Metadata (defaultTempoBpm/measureCount/timeSignature) is read from the loaded alphaTab score via `RendererController.getSongInfo()` — no separate Song layer until library-browsing.

### Files Created
- `src/transport/localTransport.ts` — the `LocalTransport` controller + `TransportRenderer` seam.
- `src/transport/localTransport.test.ts` — 11 tests (restamp continuity, clamps, tap-a-bar, sole-writer/M2 seam).
- `src/renderer/createRenderer.ts` — added `getSongInfo()` + `setMasterVolume`/`setMetronomeVolume`/`setCountInVolume`.
- `src/views/ChordChangesView.svelte` — view shell that drives the controller; `src/App.svelte` slimmed to a session host.

## Changelog

| Date | Change | Reason |
|------|--------|--------|
| 2026-06-26 | Initial specification | Created via /design-feature; 5 design decisions (BPM+% tempo, tap-a-bar + scrubber seek, toggleable count-in, sole writer of Transport, looping deferred to M2) |
| 2026-06-28 | Thin slice implemented; count-in/metronome spike resolved (alphaTab native); tempo step decided (5%) | Step 2 of M1 build order — controls that drive the playhead |

---

_Last updated: 2026-06-26_
