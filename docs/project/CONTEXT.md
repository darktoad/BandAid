# BandAid — Planning Context

> Last updated: 2026-06-26

## Architecture Decisions

| # | Topic | Decision | Date |
|---|-------|----------|------|
| 001 | renderer | alphaTab (FOSS, Path B); Soundslice retained as authoring/reference | 2026-06-25 |

## Current Phase

**Phase:** M1 Build Started — renderer-playhead foundation runs.

All five M1 specs written; stack chosen (Svelte/TS/Vite). The app scaffold + the
`renderer-playhead` foundation are built and run: a sample tune renders in notation/tab
via alphaTab, with the session store and `projectBar` playhead math (17 tests passing).
See [Implementation Status](#implementation-status) below and `README.md` for how to run.

**Core architecture principle:** No modes — only a session (1..N participants, join is additive) + locally-chosen presentation templates over one shared playhead. "Solo" = session of one; "jam panels" = more templates, not a subsystem.

## Implementation Status

| Feature | Spec | Implementation | Notes |
|---------|------|----------------|-------|
| unified-music-model | Specified | Consumed | Canonical contract; no separate code module yet |
| renderer-playhead | Specified | **In progress** | Tasks 1–3 done, Task 4 current. 6/8 ACs; playback cursor pending real-browser check |
| local-transport | Specified | Not started | Minimal play/tempo demoed inside App; real feature next |
| chord-changes-view | Specified | Not started | |
| library-browsing | Specified | Not started | |

**App entry:** `npm run dev` → http://localhost:5173 (renders Big John McNeil in guitar tab).
**Tests:** `npm test` (17 passing). **Build/typecheck:** `npm run build` / `npm run check`.
**Active tasks file:** `docs/project/features/renderer-playhead-tasks.md`.
**One open verification:** does clicking Play sweep the cursor + play audio in a real
browser? Headless couldn't drive the AudioContext.

## Roadmap Status

- **MVP (M1) features:** 5 areas (all specified; building started)
- **Milestones:** 4 (M1 MVP → M2 Join → M3 Templates → M4 Tighten)
- **Decided:** renderer → alphaTab (ADR-001); stack → Svelte/TS/Vite (ADR-003 pending capture)
- **Open decisions:** sync-stack (P2P vs LAN relay, ADR-002), drift tolerance, setup-friction target — see `roadmap.md`

## Vision Summary

BandAid (Band Sync & Jam Companion) helps a 3–5 piece old-time/bluegrass band stay locked to the same musical position — leaderless, with per-player local views and any player able to push global changes (key, tempo, section). Success means dead-simple setup across iPhone/Android/iPad/laptop, offline-capable in the same room, drift tight enough to follow the fiddle confidently, and operable hands-free by a non-techy player. Solo-practice mode ships first (~2-week target) so a struggling bandmate can drill chord timings alone; band sync follows. Explicit non-goals: no recording, no audio streaming, no accounts, no remote jamming, no in-app authoring; reuse Soundslice + the existing Python tune-arranger toolkit rather than rebuilding them.

## Feature Specifications

| Feature | Status | File |
|---------|--------|------|
| unified-music-model | Specified | [features/unified-music-model.md](features/unified-music-model.md) |
| chord-changes-view | Specified | [features/chord-changes-view.md](features/chord-changes-view.md) |
| local-transport | Specified | [features/local-transport.md](features/local-transport.md) |
| renderer-playhead | Specified | [features/renderer-playhead.md](features/renderer-playhead.md) |
| library-browsing | Specified | [features/library-browsing.md](features/library-browsing.md) |

_All M1 (MVP) feature areas specified except the session/state model, which is folded into renderer-playhead. M1 is fully designed and buildable._

**Key decisions from chord-changes-view:** The view *is* alphaTab's native render (staff/tab + `<harmony>` chord symbols + built-in cursor) — no custom timeline (ADR-001 confirmed). Audio is toggleable (synth playback + metronome click), backing staff is selectable (local, default guitar tab), chord emphasis is cursor-only (no overlay). Clock: alphaTab's player is the local time source; transport changes write a thin session object `{playing, startBar, startTimestamp, tempo}` so M2 join is additive (an incoming change just seeks the local player to the projected position).

**Key decisions from local-transport:** Sole writer of the shared `Transport` object. Tempo shown as both BPM and % of original (~50–110%, pitch preserved via alphaTab synth rate). Seek by both tap-a-bar and a scrubber. Toggleable one-bar count-in (default on, local pref). Looping deferred to M2; built so multi-writer transport is additive.

**Key decisions from renderer-playhead (the foundation):** Stack is **Svelte + TypeScript + Vite** (capture as ADR-003). alphaTab assets (fonts/worker) + a small soundfont are **bundled locally** (network-free practice loop). One renderer component is the sole code touching alphaTab's API. Session store holds `{currentSongId, transport}` behind a `SessionStore` interface so the M2 Yjs/CRDT impl drops in without changing consumers. `projectBar(transport, now)` is the pure projection used to init cursor position and (M2) seek to a peer.

**Key decisions from library-browsing:** **Set-lists-first** home; Library is a secondary view. **Return to the list** between songs (no in-song next/prev in M1). Tapping a song shows a **brief detail card** (key+mode, tempo, time sig, available views from content flags) before loading. Read-only from a **bundled static manifest** (no creation/editing — post-MVP). **Open sets `currentSongId`** in the session store — the single seam to renderer-playhead.

## Phase Update (2026-06-26)

**Phase:** M1 fully designed — ready to build. All five M1 feature specs done (unified-music-model, renderer-playhead, local-transport, chord-changes-view, library-browsing). Stack picked (Svelte/TS/Vite). Two ADRs still to capture with `/decide`: **ADR-003** (Svelte stack — already decided, just record it) and **ADR-002** (sync-stack, P2P vs LAN relay — needed before M2, parallel to M1 build).

**Key architecture from unified-music-model:** App is a pure *consumer* of canonical song files. All music processing (OMR, reduction, voicing, section labeling, corrections) lives in a **separate offline song-processing tool** (Claude + tune-arranger toolkit) — potentially replacing Soundslice via `photo → Claude ABC → toolkit → canonical MusicXML`. MusicXML is the single source of truth; sources stay immutable; no runtime override layer. Sample analysis confirmed chords/tab/key/tempo present in toolkit files; gaps to fix upstream: explicit mode (modal keys), section/rehearsal marks, chord offsets, pickup/bar-numbering convention, file naming, cello part.

## Key References

- `docs/project/vision.md` — full vision
- `docs/project/roadmap.md` — milestones, MVP, dependencies, open decisions
- `docs/reference/band-sync-app-brief.md` — technical build brief (sync model, renderer paths, milestones, gotchas)

## Suggested Next Actions

1. `/design-feature unified-music-model` — the foundation everything renders over.
2. `/design-feature chord-changes-view` — the specific 2-week learning deliverable (likely alphaTab + chords + cursor).
3. `/decide sync-stack` — needed before M2 Join; can run in parallel with M1 build.
4. Start building M1 (renderer locked: alphaTab).
