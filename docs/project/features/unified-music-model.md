# Feature: Unified Music Model

> Specification generated on 2026-06-25
> Part of: M1 (MVP) — the foundation every other feature renders over
> Renderer decision: [ADR-001 alphaTab](../architecture-decisions/001-renderer.md)

## Overview

**Purpose:** Define the single canonical data contract that represents a song in BandAid, so every presentation template and the sync layer read from one consistent shape — regardless of where the song originally came from.

**User Story:** As any band member, I want every song — whether it started as an old-time lead sheet, a Soundslice export, or a photo of sheet music from another era — to behave identically in the app, so I can browse a library, load a set list, and see my instrument's view without caring about the song's origin.

**Scope:** This feature covers (1) the **canonical song contract** the app consumes — the standardized MusicXML shape plus a small metadata sidecar — and (2) the **Library → Set list → Song** structure the app browses. It explicitly does **NOT** include: the song-processing tool that *produces* canonical files (OMR/transcription, reduction, chord voicing, section labeling, corrections — all upstream and offline), notation editing, or faithful reproduction of complex source arrangements.

## Architecture Boundary (read this first)

All music intelligence is upstream and offline. The app is purely a consumer.

```
AUTHORING / CONTENT PIPELINE  (separate tool, offline, once per tune)      RUNTIME APP (this project)
  photo ──[Claude → ABC]──┐                                               ┌──────────────────────────┐
  raw MusicXML ───────────┼─► reduce to lead sheet · generate tab ·       │ canonical song files     │
  existing ABC ───────────┘   label sections · bake corrections           │  + library/setlist JSON  │──► render (alphaTab)
                              (Claude-assisted + tune-arranger toolkit)    │                          │    sync · templates
                                            │                             └──────────────────────────┘
                                            └────────► CANONICAL SONG FILES ────────┘
```

Consequences:
- The app **never** transcribes, reduces, voices chords, computes modulation, or edits notation. It renders whatever the canonical file contains.
- Source photos/exports are **immutable**; the pipeline transforms them into a clean canonical file. Corrections are baked in upstream, so the app treats the canonical file as the **single source of truth** — no runtime override layer.
- The song-processing tool is its own future spec; the canonical contract below is the interface between it and the app.

## Core Principle Link

Consistent with the project's "no modes, only a session + local presentation templates" principle: a Song is defined **once**; notation, tab, chord-changes-in-time, chord diagrams, scale maps, and song card are all **local presentation templates over this one model**. What a song *offers* is governed by its content flags (below).

## Reduction Principle

Every song, regardless of era/genre/arrangement, is reduced upstream to a lead sheet: **`{ melody line, chord changes, form, key, tempo }`**, from which the toolkit generates band tab. Complex source detail (inner voices, exact voicings) is deliberately discarded. The app is a lead-sheet + tab band tool, not a score reader.

## Data Model

### Hierarchy

```
Library  ── all known songs (a couple dozen, growing)
  └─ Song ── canonical, defined once
SetList  ── ordered selection of songs from the Library (4–6 for a gig/rehearsal)
  └─ SetListEntry ── reference to a Song (+ optional per-gig overrides)
```

### Song (canonical contract)

A Song = a pointer to its canonical MusicXML + the small set of logical facts MusicXML cannot reliably carry.

```typescript
interface Song {
  id: string;                 // stable, source-independent
  title: string;
  source: {
    type: 'toolkit' | 'ocr' | 'import';
    files: { canonicalMusicXml: string; raw?: string };  // raw kept immutable for provenance
  };

  // Defaults (live in MusicXML; surfaced here for browsing/cards without parsing the file)
  defaultKey: { fifths: number; mode: string; tonalCenter: string }; // mode/center EXPLICIT, not derived from fifths
  defaultTempoBpm: number;
  timeSignature: string;      // e.g. "4/4", "6/8" (may change mid-tune; see sections)

  // Structure
  measureCount: number;
  hasPickup: boolean;         // anacrusis — drives consistent bar numbering for sync
  sections: Section[];        // from <rehearsal> marks upstream, or empty

  // Parts present in THIS file (varies by source)
  parts: Part[];

  // Content capability flags (what templates the app may offer)
  content: {
    hasMelody: boolean;
    hasChords: boolean;
    hasTab: boolean;
  };
}

interface Part {
  id: string;                         // stable machine id
  instrument: 'fiddle' | 'guitar' | 'ukulele' | 'bass' | 'cello' | 'melody';
  notationType: 'notation' | 'tab';
  musicXmlPartId: string;             // maps to the <score-part> in the file (OCR labels won't match instrument)
}

interface Section { label: string; startBar: number; endBar: number; }

interface SetListEntry {
  songId: string;
  keyOverride?: { tonalCenter: string; mode: string };  // "tonight, in D" — future-proofed; MVP may ignore
  tempoOverride?: number;
}
```

### Key/Tempo Layering

`MusicXML default → optional set-list override → live session value` (each falls back upward).
- **MVP behavior:** two layers only — MusicXML default → live session value. The `keyOverride`/`tempoOverride` fields exist in the data shape so per-gig pinning is not a later rewrite, but no MVP UI sets them.

### Storage (MVP)

Canonical song files + a library/set-list JSON manifest are delivered as static assets (bundled or fetched). In-app creation/editing of set lists is post-MVP; MVP reads the manifest. Persistence of user-created set lists is a later concern.

## Canonical Contract — Input Standards

These are the standards the **song-processing tool / toolkit must emit** so the app's ingest is thin and uniform. Derived from analysis of the 7 sample tunes (see Open Questions for the empirical basis).

| Standard | Requirement | Evidence / reason |
|----------|-------------|-------------------|
| Timing grid | `divisions` consistent (samples use 10080) | Uniform across all samples; canonical model expresses positions in beats |
| Parts (toolkit) | Stable set + names: Fiddle, Guitar (tab), Ukulele (tab, high-G), Bass (tab) | Identical across all multipart samples |
| Part alignment | All parts share equal measure counts (aligned barlines) | Required for sync-by-bar to be valid |
| Chords | Real `<harmony>` (root + kind), not text | Present in every sample; drives chord-changes view |
| **Key mode** | **Always emit `<mode>`; encode true mode (major/mixolydian/dorian/…), not just `fifths`** | 2 samples had no mode; `fifths` is ambiguous for modal old-time |
| **Pickup / bar numbering** | Deliberate, documented anacrusis convention | Odd measure counts (9/17/18) imply pickups; sync `startBar` must mean the same on every device |
| Sections | Emit `<rehearsal>` marks for A/B/Head/etc. | No sample carried section labels; needed for the section pointer |
| Chord onset | Prefer explicit `<harmony><offset>` (or accept inference from preceding note durations) | No sample used `<offset>` |
| File naming | `NN_Title_{single|multipart}.musicxml`; remove stray duplicates | One un-numbered duplicate found (`BigJohnMcNeil_multipart.musicxml`) |

## Requirements

### Functional Requirements

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-1 | App loads a Library of canonical songs from a manifest | Must |
| FR-2 | App represents Set lists as ordered references to library songs | Must |
| FR-3 | A Song exposes default key (with explicit mode/tonal center), tempo, time signature, measure count, pickup flag | Must |
| FR-4 | A Song declares content flags (hasMelody/hasChords/hasTab) and its parts with instrument + notationType | Must |
| FR-5 | App offers presentation templates based only on a song's content flags/parts | Must |
| FR-6 | Chords are available with bar/beat timing for the chord-changes-in-time view | Must |
| FR-7 | Sections (when present) are available with start/end bars for the section pointer | Should |
| FR-8 | Data shape supports per-set-list key/tempo overrides (UI later) | Should |
| FR-9 | App tolerates OCR-origin songs that have melody+chords but no tab (limits templates gracefully) | Must |

### Non-Functional Requirements

| ID | Requirement | Target |
|----|-------------|--------|
| NFR-1 | Any parsing the app does of untrusted/sidecar data is hardened | Use `defusedxml`-equivalent in the processing tool; app prefers alphaTab for MusicXML parsing |
| NFR-2 | Bar numbering is identical across all devices for a given song | Deterministic from canonical file + pickup convention |
| NFR-3 | Adding a song requires no app code change | Manifest + canonical file only |

## Edge Cases & Error Handling

| Scenario | Expected Behavior |
|----------|-------------------|
| Song has no tab (OCR lead sheet) | Offer notation + chord-changes templates only; hide tab templates |
| Song has no melody (chords-only) | Offer chord-based templates only; never offer a notation/melody view |
| `<mode>` missing in file | Canonical sidecar supplies explicit mode; never infer key from `fifths` alone |
| No section markers | Section pointer/form features degrade gracefully (whole tune = one implicit section) |
| Pickup measure present | Bar numbering follows the documented convention so sync stays aligned |
| Mid-tune key/meter change | Rendered as-is from MusicXML; sections may carry differing key/meter |
| No cello part (toolkit currently emits 4 parts) | `cello` simply absent from `parts`; future toolkit extension |

## Acceptance Criteria

- [ ] A canonical Song schema is documented and a TypeScript interface exists.
- [ ] All 7 sample tunes load into the canonical model (key+mode, tempo, time, measures, pickup, parts, content flags, chords with timing).
- [ ] A Library manifest + Set list structure loads and lists songs in order.
- [ ] The app selects available presentation templates purely from a song's content flags/parts.
- [ ] A simulated OCR song (melody+chords, no tab) loads and correctly offers no tab templates.
- [ ] Bar numbering for a tune with a pickup is deterministic and documented.
- [ ] The input-standards table is published for the toolkit/processing-tool to target.

## Dependencies

### Depends On
- **alphaTab** (ADR-001): renders/parses the canonical MusicXML; source of chords/notes/tab/cursor.
- **Canonical files** from the (separate, offline) song-processing tool + tune-arranger toolkit.

### Depended On By
- chord-changes-in-time view (M1 deliverable)
- session/sync model (which song + transport reference Song IDs and bar numbers)
- all presentation templates (notation/tab/chord diagrams/scale maps/song card)
- set list + mode switch

## Acquisition Finding (2026-06-25 test)

Tested `photo → Claude ABC` against Soundslice OMR on 4 real lead sheets (Stone's Rag, East Tennessee Blues, Wabash Cannonball, Old Blue):
- **Claude reads clean printed lead sheets accurately.** Stone's Rag transcribed and verified note-for-note against both the photo and Soundslice (incl. the `A♯` accidental). → **Soundslice is not required for acquisition.**
- **Mechanically converting Soundslice's MusicXML inherits its quirks/errors** — literal swing-as-ties (56 ties in Stone's Rag), a mishandled grace note (Wabash), and genuine OMR errors (East Tennessee Blues B-part has impossible durations: two half-notes in a 2/4 bar). Soundslice export is a draft, not ground truth.
- **Soundslice exports are also structurally inconsistent**: `divisions` differs per file (16/8/96), no `<mode>`, one chord tagged `kind="other"`, `.xml` extension → would need normalization regardless.
- **Confirmed decision:** standardize on `photo → Claude ABC → toolkit → canonical MusicXML`; keep Soundslice only as an optional cross-check.
- **Caveat → required tooling:** accurate full-tune transcription needs a **render+listen verification loop** (ABC → audio/notation, compare to photo, iterate). Eyeballing alone leaves errors in tricky passages. The clean-print *A parts* are reliable; whole tunes need the loop. This belongs in the separate song-processing tool.
- Sample ABC outputs saved under `docs/reference/samples/abc/` (Stone's Rag verified; others are flagged drafts).

## Open Questions

- [ ] **Soundslice OCR sample:** tested — see Acquisition Finding above (it works but inherits OMR errors; photo→ABC preferred).
- [ ] **Modal-key encoding:** does the toolkit/MusicXML reliably emit true mode (mixolydian/dorian), or is mode a sidecar field?
- [ ] **Pickup / bar-numbering convention:** define it explicitly (it underpins sync correctness).
- [ ] **Chord onset:** add explicit `<offset>` upstream, or compute onset from note durations in ingest?
- [ ] **Cello:** toolkit currently emits 4 parts (no C–G–D–A cello) — future extension.
- [ ] **Storage/persistence** of user-created set lists (post-MVP).

## Implementation Status

**Status:** Not Started
**Last Worked:** -
**Progress:** 0/7 acceptance criteria

### Implementation Notes
_Notes will be added here as implementation progresses via `/impl-feature`._

### Files Created
_Tracked here as created._

## Changelog

| Date | Change | Reason |
|------|--------|--------|
| 2026-06-25 | Initial specification | Created via /design-feature; informed by analysis of 7 sample tunes + decision that processing is a separate offline tool |

---

_Last updated: 2026-06-25_
