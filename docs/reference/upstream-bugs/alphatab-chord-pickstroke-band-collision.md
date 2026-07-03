# alphaTab: chord names and pick-stroke glyphs share an effect band and collide

**Project:** [CoderLine/alphaTab](https://github.com/CoderLine/alphaTab)
**Suggested title:** Effect band sharing places chord names and pick strokes in the same row by beat order, without checking glyph widths — glyphs overlap or superimpose
**Environment:** @coderline/alphatab 1.8.3, Chromium, SVG rendering mode
**Local workaround:** `patches/@coderline+alphatab+1.8.3.patch` (via patch-package) — see below.

## Summary

`EffectChordNames` and `EffectPickStroke` both report `canShareBand = true`, so the
effect-band layout packs chord-name text and pick-stroke glyphs (up/down-bow marks from
MusicXML `<up-bow>`/`<down-bow>`, imported as `beat.pickStroke`) into the **same band
row** whenever their beats are compatible. The slot-assignment check
(`EffectBandSlot.canBeUsed`) compares only **beat order**:

```js
// dist/alphaTab.core.mjs (1.8.3), EffectBandSlot
canBeUsed(band) {
  if (!(!this.shared.uniqueEffectId && band.info.canShareBand || band.info.effectId === this.shared.uniqueEffectId)) return false;
  if (!this.shared.firstBeat) return true;
  if (this.shared.lastBeat === band.firstBeat) return true;   // ← same beat still "usable"
  if (this.shared.lastBeat.isBefore(band.firstBeat)) return true;
  ...
}
```

Two failure modes follow:

1. **Same beat → superposition.** A chord symbol and a bow mark on the same beat pass the
   `lastBeat === band.firstBeat` check and render **on top of each other** (a "G" with a
   down-bow strike through it).
2. **Adjacent beats → horizontal crowding.** A wide chord label (e.g. bold "D7") extends
   past its beat slot into the neighboring bow glyph sharing the row. Visible whenever the
   layout is dense (narrow viewports, small bars-per-row, 2/4 fiddle tunes).

Width is never consulted when deciding to share, so any text-bearing effect
(chord names are the widest) sharing with glyph effects will eventually collide.

## Steps to reproduce

Render any MusicXML with a `<harmony>` (chord symbol) and a `<down-bow>` technical
notation on the same or adjacent beats, e.g. bar 1 of our Old Blue chart
(`public/songs/old-blue.musicxml`): harmony G on beat 1, down-bow on beat 1 and up-bow on
beat 3. At `display.barsPerRow: 2` and a 375px-wide container the chord "G" and the bow
marks render in one row; the same-beat case superimposes them at any width.

Observed (before workaround): chord letter struck through by the bow glyph; at other
bars the chord text and marks abut/overlap horizontally.

## Expected

Chord names should occupy their own effect band row (standard engraving puts the chord
row above articulation/bowing rows), or band sharing should account for the actual glyph
x-extents before packing two effects into one row.

## Local workaround (this repo)

`patch-package` flips one getter so chord names refuse to share:

```diff
 class ChordsEffectInfo extends EffectInfo {
   get canShareBand() {
-    return true;
+    return false;
   }
```

Applied by the `postinstall` script from `patches/@coderline+alphatab+1.8.3.patch`.
Effect: chord symbols get a dedicated row per system; pick strokes keep their own row
below. Verified across all four bundled charts at 375/768/desktop widths — no remaining
overlap; systems with both effects grow one band-row taller, which is correct engraving.

**Upgrade note:** patch-package fails loudly if the alphaTab version changes — re-verify
whether upstream fixed the band-sharing logic before regenerating the patch.
