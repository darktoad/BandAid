# BandAid — Band Sync & Jam Companion — Project Vision

> Generated from planning conversation on 2026-06-25
> Companion source: `docs/reference/band-sync-app-brief.md` (technical build brief)

## Problem Statement

A small acoustic old-time/bluegrass ensemble (3–5 players) has no reliable way to stay aligned on the *same tune at the same moment*. Following the fiddle player is guesswork on harder tunes, there is no shared playhead or shared tempo that the whole group sees, and improv sessions repeatedly collapse into disagreement — "what key was that?", "what chord did you just play?", "whose solo is next?" — because the band spans a wide range of music-theory and notation fluency.

Today the band cobbles together personal tools. Soundslice holds authored arrangements but its playback is per-person and account-bound — nothing locks a band-wide playhead or lets *anyone* nudge tempo for *everyone*. There is no instrument-specific jam reference (fretboard chord shapes, scale maps, licks per key and per tuning) anywhere in the current toolchain, and no single shell that holds a set list, switches between notated and jam modes, and carries one shared song-state.

There is also an immediate, concrete pain: a bandmate is struggling to learn the chord timings on several songs. There is no good way for them to drill those changes *on their own* before rehearsal, so band time gets spent teaching parts instead of playing together confidently.

## Target Users

### Primary Users
The band itself — this is a tool for one specific group, not a product for a market.

- **Who:** A 3–5 piece acoustic / old-time / bluegrass ensemble.
- **Technical Level:** Mixed and explicitly low at the low end. The fiddle player is not very tech-savvy and must be able to operate the app **hands-free** during play (control her own view, tempo, and other shared settings without fiddling with the device).
- **Key Need:** Stay locked to the same musical position as everyone else while keeping a personal, local view of their own instrument's part.

**Specific players & instruments (drives reference-panel generation):**
- Primary user: guitar, high-G *re-entrant* ukulele (G4 C4 E4 A4, strings unchanged, capo available), UBass, occasionally electric cello (C–G–D–A fifths).
- Bandmate: fiddle, reads standard notation.

### Secondary Users
None. No public users, no accounts, no sharing beyond the band.

## Goals

### Primary Goals
1. **Solo-practice mode first (near-term, ~2-week target):** Let a single player drill chord timings against a synced playhead on their own device, no multiplayer required — so the struggling bandmate can learn the changes before rehearsal.
2. **Leaderless band sync (the payoff):** Synchronize musical *position* — not the screen — across all devices, so the whole band follows confidently without a designated leader/host. Any player can push global changes (key, tempo, section/turn, transport).
3. **Per-player local views:** Each player sees their own instrument's part, scrolled/zoomed/selected however they like, while shared musical state stays in lockstep.
4. **Jam alignment:** A shared key/tempo/section/"whose turn" state plus per-instrument reference panels (chord diagrams, scale maps, curated licks) so improv stops devolving into theory/notation arguments.
5. **Effortless setup for rehearsals and infrequent gigs:** Getting all devices into the same session must be fast and foolproof in a live setting.

### Success Criteria
- **Setup friction:** All players' devices join the same session quickly and reliably with no technical fuss, in a rehearsal or gig setting. (Target threshold TBD — e.g. "under ~30s, no typing required" — pin during eng review.)
- **Sync tightness:** Playhead drift between devices stays tight enough to confidently follow the fiddle. (Exact tolerance TBD — quantify a millisecond/bar budget during eng review; "good enough to follow-along" is the bar, not sample-accuracy.)
- **Hands-free operability:** The non-techy fiddle player can control her view, tempo, and shared settings during play without assistance.
- **Cross-platform:** Runs on iPhone, Android phone, iPad, and laptop.
- **Offline-capable:** Works in the same room without depending on an internet connection wherever possible.
- **Real-world adoption:** The band actually runs a rehearsal (and an upcoming gig) on it, and the struggling bandmate learns the songs faster using solo-practice mode.

## Constraints & Non-Goals

### Constraints
- **Devices:** Must run on iPhone, Android phone, iPad, and laptop → web app / mobile-web first.
- **Connectivity:** Internet is *allowed* but should not be *required*. Same-room / LAN operation should work offline; this points toward the same-room rehearsal path and away from heavyweight cloud signaling. (Remote/different-house jamming is explicitly out of scope, which removes the hardest connectivity requirement.)
- **Hands-free, low-tech operability:** The UI must be usable by a non-tech-savvy player during play.
- **Local vs. synced split is sacred:** Scroll, zoom, pan, and instrument selection are **local per device** and must never be written to shared state. Only musical position / logical state is synced.
- **Reuse existing assets, don't rebuild them:**
  - **Soundslice** (paid) — arrangements already authored (synced multi-part notation, per-part mute/solo, tempo, looping, shareable links).
  - **Python tune-arranger toolkit** — ABC → 4-part MusicXML + chartbook PDF, with a Viterbi/DP campanella-aware fingering optimizer, string-map legend generator, and LilyPond/music21 engraving. Tunings and high-G uke conventions already encoded. The fingering optimizer is the reusable engine for jam-mode chord/scale generation.
  - A working **8-tune set** (reels, jigs, songs, one chords-only copyrighted tune).
- **Copyright:** At least one tune is chords-only by design — the data model must flag it so the app never renders a melody for it.
- **Files don't persist between Claude sessions:** Re-supply source files (MusicXML, optimizer, tuning defs) when continuing work.

### Explicit Non-Goals
- **No band recording** — the app does not record the group playing.
- **No audio streaming between players.**
- **No accounts / login / user management.**
- **No multi-site / remote (different-house) jamming.**
- **No song authoring inside the app** — arrangements come from the existing toolchain.
- **Not a product** — no market, no public users, no monetization.

## Differentiation

Nothing in the current toolchain does **leaderless, band-wide synchronization of musical position**. By syncing a tiny deterministic state object (`{startBar, startTimestamp, tempo}` for notated transport; `{key, tempo, section, whoseTurn}` for jam) and computing position *locally* on every device, the design **eliminates host migration entirely** — no one is the clock during playback, peers are symmetric, late joiners pull state from any neighbor, and a dropped peer is a non-event.

Second, the **instrument-specific jam reference** is unique to this band's situation: the existing fingering optimizer, pointed at chord tones or scale degrees instead of a melody, generates playable chord voicings and scale maps for *any* tuning already defined (guitar, high-G uke, UBass, cello). No off-the-shelf tool knows the band's exact instruments and tunings the way this engine already does.

## Initial Feature Ideas

Based on the vision, these features seem essential:
1. **Solo-practice mode** — single-device synced playhead + chord changes to drill against (ships first).
2. **Shared-state core** — leaderless CRDT (Yjs + Trystero / y-webrtc), tempo + section pointer any device can change.
3. **Clock-sync handshake** — NTP-style offset exchange + latency projection for a tight notated playhead.
4. **Notated mode with one renderer** — Soundslice embed (path A) or alphaTab (path B); cursor slaved to computed position; multi-writer transport.
5. **Set list + mode switch** — ordered shared set list; tap a tune to load its renderer or jam card.
6. **Jam reference panels** — chord diagrams + scale maps per instrument/tuning via the fingering optimizer, rendered as SVG.
7. **Song card + lick library** — feel/form/solo-order metadata + a small curated lick set per key/style.

_These are initial ideas — prioritize and detail them using `/define-roadmap` and `/design-feature`._

---

## Open Decisions To Capture Formally

The user explicitly wants constraints and technical choices captured as decisions (use `/decide`):
- **Renderer:** Soundslice embed (path A, fastest, reuses owned arrangements, soft-seek drift correction) vs. alphaTab custom (path B, tightest lock, most build). Brief expects a hybrid end state (path C).
- **Sync stack:** Yjs + Trystero / y-webrtc (P2P) vs. a ~30-line LAN WebSocket relay for pure same-room (simpler, offline by default). The "no internet required, same-room" constraint may favor the LAN relay for v1.
- **Drift tolerance:** quantify acceptable playhead drift.
- **Setup-friction target:** quantify "easy to join a session."

## Next Steps

1. Review this vision document and adjust anything that's off.
2. Run `/define-roadmap` to prioritize features and define the MVP (solo-practice mode first).
3. Use `/decide` to formally capture the renderer and sync-stack decisions before building.
4. Use `/design-feature [name]` to spec out each feature in detail.
