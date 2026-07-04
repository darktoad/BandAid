# BandAid — Development Roadmap

> Generated from planning conversation on 2026-06-25
> Based on vision defined in [vision.md](vision.md)

## Guiding Architecture: No Modes, Only Sessions + Templates

Two principles shape this entire roadmap. Honor them in every feature:

1. **There are no modes — only a session.** A single player is a session of one; adding players is a *join event*, never a host/share/mode switch. A session of one and a session of N run the same code. (So-called "solo practice" is simply a session before anyone joins.)
2. **All music is defined once; players choose local presentation templates over a shared playhead.** The same unified song data is rendered as notation, the player's instrument tab, chord-changes-in-time, chord diagrams, scale maps, or a song card — *chosen per device, never synced.* "Jam panels" are not a separate subsystem; they are additional presentation templates over the same musical position.

What is shared: tiny logical state (which song, transport `{startBar, startTimestamp, tempo}`, key, section/turn, set list). What is local: scroll, zoom, instrument selection, and **which presentation template** is shown. Each device computes its own playhead position locally.

## Roadmap Overview

```
M1: Session of One (MVP)    M2: Join                  M3: Presentation Templates   M4: Tighten When Needed
~2 weeks                    ──────────────────────    ──────────────────────────   ──────────────────────
Unified music model         Real multiplayer join     Per-instrument notation/tab  NTP clock sync (if needed)
  (Library/Set list/Song)   Shared logical state      Chord diagrams (per tuning)  Live note/key/chord detect
Renderer + playhead         Presence                  Scale maps (per tuning)        + highlighting
Chord-changes view          Loose follow-along        Song card                    Lick-library content
Local transport             Shared set list           Template switching UI        "One device listens & syncs"
  (play/pause/tempo/seek)   Multi-writer transport
Browse library / set list
```

## MVP Definition

**Core Value Proposition:** A single player can open any song from their library and drill its chord changes against a moving playhead on their own device — built session-shaped so multiplayer is a later addition, not a rewrite.

**MVP Features:**

| Feature | Description | Why MVP |
|---------|-------------|---------|
| Unified music model | One data definition per song (melody, chords, form, key, tempo). Content hierarchy: **Library → Set lists → Songs**. | Everything else renders over this; getting the shape right now avoids a rewrite. |
| Library + set list browsing | Browse a library of ~couple-dozen songs; pick a song; set lists are ordered selections (4–6 songs) from the library. | Guitarist is learning *several* songs and wants to drill "the set." |
| Renderer + local playhead | One renderer showing a song with a playhead computed locally from `{startBar, startTimestamp, tempo}`. | The thing they watch while practicing. |
| Chord-changes-in-time view | A presentation template that shows chord changes against the moving playhead. | This is the specific learning need: chord *timings*. |
| Local transport | Play/pause, tempo, and **manual playhead positioning (seek)**. | Drilling requires slowing down and jumping around. Manual seek is the accepted floor; looping is a fast-follow. |
| Session-shaped state | All of the above sits on the real session/state model (a session of one), even with networking deferred. | "Join" must be additive later, not a rewrite. |

**MVP Success Criteria:**
- Runs on iPhone, Android, iPad, and laptop (web).
- Works for a single player with no internet dependency for the practice loop itself.
- Guitarist can independently learn chord timings for the rehearsal songs without the band present.
- No code written in M1 has to be thrown away to add join in M2.

## Milestone Breakdown

### Milestone 1: Session of One (MVP)
**Goal:** A standalone-feeling practice experience that is secretly a session of one, ready in ~2 weeks for the guitarist.
**Features:**
- [x] Unified music model + content hierarchy (Library / Set lists / Songs) — *M1 scope: a bundled manifest (library + set lists) + per-song timing read from the score; full canonical Song model stays in the offline tool*
- [x] Browse library, view/select a set list, load a song — *set-lists-first home, Library, detail card, Open → currentSongId*
- [x] Renderer with locally-computed playhead
- [x] Chord-changes-in-time presentation template — *incl. shared-melody default + stacked "My part" overlay, responsive mobile layout (D3/D6)*
- [x] Local transport: play/pause, tempo, manual seek — *+ count-in, scrubber; on-device confirmed*
- [x] Session/state model in place (single participant; networking deferred)

### Milestone 2: Join
**Goal:** Turn a session of one into a session of N — no host, loose follow-along — so the band can play together.
**Features:**
- [ ] Real multiplayer join over the chosen transport (see Decisions)
- [ ] Shared logical state (which song, transport, key, section) — multi-writer; conflict rule per [ADR-002](architecture-decisions/002-sync-stack.md) D2 (intent stamps sync with a dedicated `issuedAt`, newest press wins on apply; mechanical re-anchor stamps stay local)
- [ ] Presence (who's in the session)
- [ ] Late-joiner state transfer (pull current state from any peer)
- [ ] Shared set list (any player can advance/select)
- [ ] Loose follow-along playhead (each device computes locally; accept modest drift)
- [ ] **Fast-follow:** loop in/out with speed change (deferred from M1)

### Milestone 3: Presentation Templates
**Goal:** Give each player the view that fits their instrument and the moment — all over the same synced playhead.
**Features:**
- [ ] Per-instrument standard notation / tab (fiddle notation; guitar/uke/bass tab; cello)
- [ ] Chord diagrams per tuning (via the existing fingering optimizer over chord tones)
- [ ] Scale maps per tuning (scale degrees on each fretboard/fingerboard, SVG)
- [ ] Song card (feel, form/roadmap, solo order, reference track)
- [ ] Local template-switching UI (per device, never synced)
- [ ] **Lyrics chord-progress sync** — live highlight of the current chord/verse in the
      notes-and-lyrics slide-over, mirroring the chord-overlay's sweeping fill.
      **Not started; backlog, no urgency.** Scoping note (2026-07-03): `chordTimeline`
      (parsed from MusicXML `<harmony>`, has real bar/beat) and `chordpro` (the lyrics
      file, chord tokens only know their char-offset in a line) are unlinked today, and
      most charts repeat the same bars once per verse — a naive chord-sequence match
      between the two breaks after verse 1. Cheapest real version: highlight the whole
      current verse/section by counting repeat-passes (the transport already restamps on
      repeats); reuses existing machinery, no new authoring. Precise per-chord sync needs
      a one-time bar-alignment pass per song, most naturally added to the offline
      song-processing tool, before the app-side highlighting (straightforward reuse of
      the `ChordOverlay` pattern) is worth building.

### Milestone 4: Tighten When Needed
**Goal:** Add precision and live intelligence only after real use proves it's needed.
**Features:**
- [ ] NTP-style clock-sync handshake + latency projection — **only if loose follow-along is measured insufficient**
- [ ] Live note/key/chord detection + highlighting (a device listens to the room)
- [ ] "One device listens and syncs the group" (future sync source)
- [ ] Lick-library content (curated phrases per key/style, rendered via the MusicXML/LilyPond pipeline)

## Dependencies

```
Unified music model ──→ everything (all templates render over it)
Session/state model (M1) ──→ Join (M2) ──→ Shared set list, presence, loose follow-along
Loose follow-along (M2) ──→ decision gate ──→ NTP clock sync (M4, only if needed)
Fingering optimizer (existing) ──→ Chord diagrams + Scale maps (M3)
Live detection (M4) ──→ "one device listens & syncs" (M4)
```

| Feature | Depends On | Reason |
|---------|-----------|--------|
| Everything | Unified music model | All presentation is a view over the one data model |
| Join (M2) | Session/state model (M1) | Join is additive to the session shape |
| Shared set list, loose follow-along | Join (M2) | Need multiplayer transport first |
| NTP clock sync (M4) | Measured drift from loose follow-along (M2) | Build only if loose proves insufficient |
| Chord diagrams / scale maps (M3) | Existing fingering optimizer + tuning defs | Reuse the engine, don't reinvent |
| "One device listens & syncs" (M4) | Live detection (M4) | Sync source derived from detection |

## Decisions To Settle Before Building

Capture these formally with `/decide`:

1. ~~**Sync stack (settle before M2; informs M1 session shape)**~~ — **Decided 2026-07-03, [ADR-002](architecture-decisions/002-sync-stack.md):** Yjs + `y-indexeddb` + Cloudflare PartyServer (`y-partyserver`) + optional `y-webrtc`, behind a provider interface. v1 posture: internet required to *join*; solo/offline practice and export/import work with zero network (ADR-002 D3).
2. **Renderer (settle before/within M1):** Soundslice embed (path A — fastest, reuses owned arrangements, soft-seek drift correction) vs. alphaTab custom (path B — tightest lock, most build). Brief expects a hybrid end state.
3. **Drift tolerance (gate for M4):** quantify what "tight enough to follow the fiddle" means before deciding whether NTP clock sync is needed.
4. **Setup-friction target:** quantify "easy to join a session" (e.g. under ~30s, no typing).

## Explicitly Out of Scope

These were discussed and excluded (from the vision's non-goals):
- **Band recording** — the app does not record the group.
- **Audio streaming between players** — no inter-device audio. *(A device may later listen to derive sync — that is detection, not streaming.)*
- **Accounts / login** — none.
- **Multi-site / remote (different-house) jamming** — same-room (and offline) is the target; this removes the hardest connectivity requirement.
- **In-app song authoring / processing** — the app only *consumes* canonical song files. All processing (OMR/transcription, lead-sheet reduction, chord voicing, section labeling, OCR corrections) lives in a **separate offline song-processing tool** (Claude-assisted + the tune-arranger toolkit). See `features/unified-music-model.md` for the boundary.

## Companion Tooling (outside the app)

- **Song-processing tool** (separate, offline; its own spec later): photos / raw MusicXML / ABC → canonical song files. **Acquisition path confirmed (2026-06-25 test):** `photo → Claude ABC → toolkit → canonical MusicXML` works and beats Soundslice (cleaner, standardized, +tab). Soundslice optional cross-check only. **Must include an ABC→audio render+listen verification loop** — clean-print A-parts transcribe reliably, but whole tunes need verification to be correct. See unified-music-model "Acquisition Finding".
- **Tune-arranger toolkit standardization** (action list from sample analysis, see unified-music-model spec): always emit `<mode>` with true mode; emit `<rehearsal>` section marks; explicit chord `<offset>`; standardize file naming + remove stray duplicate; pin a pickup/bar-numbering convention; (future) add cello part.

## Feature Specification Status

| Feature | Spec Status | File |
|---------|-------------|------|
| Unified music model | **Specified** | [features/unified-music-model.md](features/unified-music-model.md) |
| Library / set list / song browsing | **Built (M1)** — manifest-driven browse shell | [features/library-browsing.md](features/library-browsing.md) |
| Renderer + local playhead | **Built (M1)** | [features/renderer-playhead.md](features/renderer-playhead.md) |
| Chord-changes-in-time view | **Built (M1)** — melody-default + stacked overlay, mobile layout | [features/chord-changes-view.md](features/chord-changes-view.md) |
| Local transport | **Built (M1)** — 8/8 ACs | [features/local-transport.md](features/local-transport.md) |
| Join / shared state | **Reviewed + Phase 1 planned** — corrections substrate spec/plan approved; build sequence in the M2 review | [multi-user-review-and-plan.md](multi-user-review-and-plan.md) |
| Presentation templates (notation/tab/diagrams/scales/card) | Not started | - |
| Live detection + highlighting | Not started | - |

_Use `/design-feature [name]` to create detailed specifications._

---

## Next Steps

1. ✅ Renderer decided (alphaTab, ADR-001) · ✅ **all five M1 feature specs done** (unified-music-model, renderer-playhead, local-transport, chord-changes-view, library-browsing) · ✅ stack picked (Svelte/TS/Vite).
2. **Build M1 — complete.** ✅ renderer-playhead (foundation) · ✅ chord-changes-view + local-transport over it (mobile layout: melody-default + stacked "My part" overlay, compact controls, responsive bars-per-row — D3/D6, on-device confirmed) · ✅ library-browsing (manifest-driven set-lists/Library/detail-card shell) · ✅ **library widened to 7 tunes / 2 set lists** from the already-processed tune-arranger samples (no separate processing tool — Claude + the existing skill is the pipeline). Remaining to fully close M1: a cross-device spot-check of the browse shell + in-app render check of the 6 newly-added tunes.
3. ✅ **ADR-002 (sync stack) captured 2026-07-03** — [ADR-002](architecture-decisions/002-sync-stack.md), incl. the M2 conflict/offline decisions. Still open: `/decide` for **ADR-003 (Svelte + TS + Vite stack)** (low urgency; the stack is a fait accompli).
4. ✅ **OMR test done** — Soundslice-free acquisition confirmed (photo→Claude ABC→toolkit); needs a render+listen verify loop in the processing tool.
