# Band Book sync model + performance view — design

**Date:** 2026-07-18
**Status:** Approved pending David's review
**Constraint:** Gig on 2026-07-19 — main is frozen until after the gig. All work lands on branches; merges begin post-gig.

## Context

Rehearsal feedback (2026-07-18) surfaced four UX problems and one sync surprise, and clarified how the band actually uses the app:

- The band almost never presses Play together. The fiddler (who doesn't use the app — she plays from printed sheets) sets tempo live; the app is *shared sheet music* for David (bass, iPad/iPhone) and the guitarist (Android tablet). Play/click/count-in are solo-practice tools.
- Fit mode behaves inconsistently; the Fit button "disappears"; fit does nothing in landscape sometimes.
- Notation can't shrink enough to show a whole page on iPad/iPhone (hard 75% scale floor).
- Lyrics/banter notes can't be seen alongside notation; the ChordPro sheet itself doesn't fit one screen.
- Header bars eat too much vertical space with no way to hide them.
- A setlist reorder on iOS never reached the Android tablet because both ran "local mode" — the sync toggle gates the *connection*, not just playback.

## Part 1 — State model: Band Book / Session / Personal

Three tiers, used consistently in UI copy and code:

### Band Book (always shared)

Syncs whenever a device is online. No toggle can turn it off. Contents:

- Set lists: order, names, membership.
- Per-song performance decisions: engraving/remix (arrangement variant), key/transpose, tempo, chords.
- Future: annotations (shared content; display settings stay personal).

Mental model: a shared binder of charts — if one member writes in it, everyone sees it.

**Tempo semantics:** the Band Book tempo is the band's agreed tempo for the tune. Local playback may run at a personal percentage of it (Personal tier); a one-tap reset returns to the book value. Changing the *book* tempo is an explicit, distinct act from nudging your practice speed.

### Session (opt-in live layer)

The existing synced playback + follow-the-leader song selection (`session.transport`, `session.song`). Kept, but demoted: the current "Sync" toggle is renamed to reflect joining a session (e.g. "Join session"), and it gates **only** this layer. Nothing else may ever depend on session state.

### Personal (never leaves the device)

Local playback state and practice-tempo percentage, view settings (fit/size, rows, chord overlay, masthead, split-view layout), "my part" selection, annotation display settings.

### Implementation notes

- The network providers (WebRTC + PartyServer) attach whenever the app is online and a band room is configured — no longer gated by the toggle ([bandSession.ts](src/sync/bandSession.ts)). The toggle now only controls the existing `publishSession` gating ([syncedSessionStore.ts](src/sync/syncedSessionStore.ts)), which already exists.
- Yjs writes for setlists/songSettings/corrections are already ungated ([setListStore.ts:11-18](src/stores/setListStore.ts)); this design makes the transport match the write policy.
- CRDT merge on reconnect already works (IndexedDB persistence is always-on); no data migration needed.
- Both devices should receive this change together (no feature flag) to avoid mixed sync semantics.

## Part 2 — Fit bug fixes (independent, ships first)

Root causes identified in [ChordChangesView.svelte](src/views/ChordChangesView.svelte):

1. **Vanishing Fit button:** Fit lives only inside the settings sheet, and `fitToView()` closes the sheet as its first act — tapping Fit removes the button. Fix: Fit gets a home outside the sheet (survives into the collapsed-header design in Part 4), and fitting no longer force-closes the sheet on wide layouts.
2. **No re-fit on rotation while sheet open:** the ResizeObserver suppresses re-fit when `showMore` is true. Fix: re-fit on orientation/resize regardless; if the sheet is open, re-fit when it closes.
3. **Non-deterministic fit:** fit computes from the *current* `scalePct`/`barsPerRow`, so results are path-dependent. Fix: compute from a canonical baseline so Fit always converges to the same result for a given song + viewport.
4. **Silent fit release:** dragging Size turns Fit off with no feedback. Fix: visible state change on the Fit control when it disengages (superseded in Part 3 where Fit and Size become independent).

## Part 3 — Page-mode Fit (whole page on any screen)

Replace scale-floor fitting with **page mode**: engrave at a normal legible scale, then CSS-transform-scale the rendered SVG down so the whole page fits the viewport — like viewing a photo of the fiddler's sheet. Properties:

- Cannot fail to fit (fixes silent landscape failure); instant (no re-engrave loop); crisp (SVG).
- The 75% engraving floor stays (it protects layout quality); it just no longer limits what fits on screen.
- Fit and the Size slider become independent: Fit = "whole page in view" (CSS transform), Size = engraving scale for scroll-at-readable-size use. They no longer fight over `scalePct`.
- Default ON: the band usually wants the entire page in view, even on a phone.
- Pinch-to-zoom is a natural follow-on (same transform) but out of scope for this round.

## Part 4 — Split view, collapsible headers, overlay default

### Notation + lyrics split view

- **Landscape:** notation pane and ChordPro/banter sheet side by side; both follow the same song and key; each pane independently scalable. The lyrics pane gets fit-to-pane so the whole ChordPro sheet can shrink into view without mid-song scrolling.
- **Portrait:** stacked (notation over lyrics) or the current full-screen lyrics toggle.
- Layout choice is Personal (per device).

### Collapsible headers (option a — approved)

- One manual toggle collapses `.topbar` + `.transport` (and the settings sheet) entirely; notation gets 100% of the screen.
- Collapsed state: a single small, semi-transparent corner button restores the bars. Nothing else on screen.
- Never triggered by play/pause or any transport state — manual only.

### Chord overlay

- Defaults **off** (personal-practice tool). Existing per-device persistence unchanged; users who turn it on keep it on.

## Part 5 — Rollout

- **Freeze:** nothing merges to main until after the 2026-07-19 gig (every main push auto-deploys to GitHub Pages, and mobile browsers silently reload backgrounded tabs — a mid-gig deploy is a real risk).
- **Beta channel (PR 0):** the Pages workflow additionally builds a designated beta branch under `/beta/` on the same origin. Opt-in by URL; fallback is the normal URL. Same origin means local data (IndexedDB/Yjs/localStorage) is shared between channels, so schema changes must stay additive (Yjs already is).
- **Escape hatch:** the Part 3+4 performance view ships behind a per-device settings toggle ("New rehearsal view") so the guitarist can revert in two taps. The Part 1 sync split ships **without** a flag (both devices together).
- **Rollback:** `git revert` + push; Pages redeploys in ~2 minutes.

## Sequencing

| PR | Contents | Risk |
|----|----------|------|
| 0 | Beta-channel Pages workflow | none (CI only) |
| 1 | Fit bug fixes (Part 2) | low |
| 2 | Band Book sync split (Part 1) | medium — both devices update together |
| 3 | Performance view: page-mode fit, split view, header collapse, overlay default (Parts 3–4) | medium — behind settings toggle |

Merge order after the gig: 0 → 1 → 2 → 3, each verified on the beta URL (iPad + Android) before promoting to main.

## Testing

- Fit determinism: same song + viewport → same result regardless of prior slider/fit history.
- Rotation: portrait↔landscape re-fits with sheet open and closed, on tablet-width layouts.
- Page mode: dense multi-page tune fully visible on iPhone-size viewport; legibility acceptable at typical shrink factors on real devices.
- Sync split: setlist edit with "session" off propagates iOS→Android; session toggle still gates transport/song-follow both ways; reconnect merge still converges.
- Split view: key change reflects in both panes; per-pane scaling persists per device.
- Beta channel: `/beta/` serves the beta branch, shares local data with stable, and stable is byte-identical before/after PR 0.

## Out of scope

- Removing Session/synced playback entirely (kept, demoted; revisit if still unused).
- Annotations feature (Band Book placement noted for when it lands).
- Pinch-to-zoom in page mode.
- Multi-user flows beyond the current 2-device band.
