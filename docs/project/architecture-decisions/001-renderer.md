# ADR-001: Renderer

> Status: Accepted
> Date: 2026-06-25
> Deciders: David, with Claude assistance

## Context

BandAid renders musical scores (notation + tab) on every player's device, with a playhead that the app must be able to drive or read so position can be computed locally and shared as tiny logical state. The renderer choice underpins the MVP (a chord-changes-in-time view for solo practice), the M3 presentation templates (per-instrument notation/tab, chord diagrams, scale maps), and the M2 loose-follow-along sync (which depends on owning the playhead).

The source material is the existing Python tune-arranger toolkit, which converts ABC (melody + chords) into 4-part **MusicXML** (fiddle in standard notation; guitar, uke, bass in tab). Arrangements also already exist in **Soundslice** (paid, authored, shareable secret links).

The decision was triggered now because the renderer is the one blocker to starting M1, and the user asked specifically whether a well-regarded FOSS option exists to start from.

### Requirements

- Render the toolkit's MusicXML directly, without re-authoring.
- Render **both** standard notation (fiddle) **and** instrument tab (guitar, high-G uke, UBass, cello), per-track.
- Expose a **cursor / playhead** the app can read or drive, so position is computed locally (the core "sync the position, not the screen" architecture).
- Support custom presentation templates over one shared playhead (chord-changes-in-time, chord diagrams, scale maps) — no modes.
- Cross-platform web: iPhone, Android, iPad, laptop.
- Local-only view controls (scroll, zoom, instrument selection) never synced.

### Constraints

- Reuse existing assets (MusicXML toolkit, Soundslice arrangements); don't rebuild them.
- No accounts / login.
- Full offline operation is **deferred** (treated as insurance for exception, not a current requirement) — internet dependency is acceptable for now.

## Options Considered

### Option 1: alphaTab (Path B)

FOSS (MPL 2.0) music notation engine that renders MusicXML and Guitar Pro files, with native tab + standard notation, per-track solo/mute, a built-in player exposing a cursor and beat callbacks, local zoom/layout, runs in the browser.

**Pros:**
- Renders the toolkit's MusicXML directly — no re-authoring.
- Native **tab and** standard notation, per-track — fits a band that lives in tab.
- Built-in **cursor + beat callbacks** → the app owns the clock; position computed locally. This *is* the project's architecture.
- Cross-platform web; local zoom/layout matches the "visual is local" rule.
- Likely collapses the MVP: chord symbols + moving cursor means the chord-changes-in-time view can *be* alphaTab, removing the need for a separate custom timeline.

**Cons:**
- More upfront wiring than dropping in an iframe (alphaTab component + thin player/clock wrapper) — but this work is required anyway to own the playhead.

**Cost/Effort:** Medium

### Option 2: Soundslice embed (Path A)

Embed Soundslice arrangements via iframe with `api=1`; listen for player events; soft-seek to correct drift.

**Pros:**
- Reuses already-authored arrangements; fastest to a working *notated* tune.
- Mature, polished playback and notation.

**Cons:**
- Iframe loaded from soundslice.com → **requires internet to render** (conflicts with the eventual offline goal).
- App does **not own the cursor** — Soundslice owns its audio clock; you sync *to* a black box via soft-seek. Fights the "own the playhead, compute locally" architecture.
- Gives *its* notation view, not the **custom** chord-changes-in-time MVP view or later custom templates.
- Account/paid-bound; not FOSS.

**Cost/Effort:** Low (to embed) / High (to fit the architecture)

### Option 3: OpenSheetMusicDisplay (OSMD)

FOSS MusicXML → SVG renderer built on VexFlow.

**Pros:**
- FOSS, clean MusicXML rendering.

**Cons:**
- **No built-in player/cursor** — timing must be built from scratch.
- **Standard-notation focused, weak tab support** — bad fit for a tab-heavy band.

**Cost/Effort:** High

### Option 4: abcjs

FOSS ABC renderer with audio synth and timing callbacks.

**Pros:**
- FOSS; built-in audio + timing callbacks (cursor support).
- Could consume the toolkit's upstream ABC.

**Cons:**
- **Limited tab support** — and the pipeline deliberately moves past ABC into MusicXML precisely to get proper multi-instrument tab. Adopting abcjs walks that back.

**Cost/Effort:** Medium-High

## Decision

**Chosen Option:** alphaTab (Path B)

**Primary Reason:** It is the well-regarded FOSS renderer that consumes the toolkit's MusicXML directly, renders both tab and notation, and exposes a cursor the app can own — which is exactly the project's "sync the position, compute locally" architecture, handed to us.

**Secondary Factors:**
- Native multi-instrument tab is a hard requirement the other FOSS options fail.
- Likely shrinks the MVP (chord-changes view = alphaTab with chords + cursor; no separate custom timeline).
- Cross-platform web with local zoom matches the "visual is local" rule.

## Rationale

The brief originally called Soundslice embed the "fastest path," but the constraints settled after the brief — owning the playhead, building custom presentation templates, FOSS preference — erode that advantage. Soundslice owns its audio clock and renders its own view, so it fights the architecture and can't natively produce the custom chord-changes-in-time MVP screen. Offline being deferred no longer disqualifies Soundslice, but the architectural and custom-view reasons still rule it out as the *runtime* renderer.

Among FOSS options, alphaTab is the only one that pairs multi-instrument tab with a built-in cursor; OSMD lacks a player and tab, and abcjs lacks robust tab and would walk back the MusicXML pipeline. The one real cost — more wiring than an iframe — is work the architecture demands regardless, and alphaTab does the rendering/tab/cursor heavy lifting.

## Consequences

### Positive

- The app owns the clock from day one; loose follow-along sync (M2) becomes a function of shared logical state.
- One renderer serves both the MVP and the M3 per-instrument templates.
- No re-authoring; the toolkit's MusicXML is the direct input.
- FOSS — no per-bandmate paid/account dependency at runtime.

### Negative

- Upfront work to build the alphaTab component + thin player/clock wrapper before anything renders.
- Custom presentation templates (chord diagrams, scale maps) still need building on top — alphaTab renders scores, not arbitrary fretboard SVGs (those come from the existing fingering optimizer).

### Neutral

- Soundslice is retained as the **authoring + reference** tool (arrangements already written there, shareable links), just not the in-app renderer.

## Reconsideration Triggers

This decision should be revisited if:
- alphaTab's cursor/timing granularity proves too coarse for "tight enough" follow-along once measured (this is the M4 clock-sync gate, not necessarily a renderer change).
- A hard offline requirement emerges *and* alphaTab's offline story (bundling assets/soundfonts) proves impractical.
- The MVP turns out to need a richer custom chord-timeline that alphaTab can't express cleanly.
- The project ever wants Soundslice's exact playback feel enough to accept it as runtime (would revive Path A / hybrid Path C).

## Related

- [vision.md](../vision.md)
- [roadmap.md](../roadmap.md) — M1 renderer, M3 presentation templates, M4 clock-sync gate
- [band-sync-app-brief.md](../../reference/band-sync-app-brief.md) — Sections 6 (build approaches) and 9 (Soundslice/renderer gotchas)
- Pending: ADR-002 sync-stack (P2P vs LAN relay)

---

_Documented: 2026-06-25_
