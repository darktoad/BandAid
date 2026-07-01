# Upstream bug reports

Found while re-processing Soundslice fiddle-tune exports through
[music21](https://github.com/cuthbertLab/music21) and rendering them with
[alphaTab](https://github.com/CoderLine/alphaTab) for this app (see
[../../../tools/song-processor/README.md](../../../tools/song-processor/README.md)). Each
file below is a self-contained, minimal reproduction ready to paste into the respective
project's issue tracker.

| Bug | Project | Impact here |
|-----|---------|-------------|
| [music21-slur-continue-dropped.md](music21-slur-continue-dropped.md) | music21 | Slurs spanning 3+ notes lose interior notes on write. Worked around in our processor (`restore_slur_continues`). |
| [alphatab-instrument-breaks-accidentals.md](alphatab-instrument-breaks-accidentals.md) | alphaTab | A per-note `<instrument>` reference (written by music21 unconditionally) silently hides every accidental in the bar. Worked around in our processor (`strip_note_instrument_refs`). |
| [alphatab-opening-note-mis-beam.md](alphatab-opening-note-mis-beam.md) | alphaTab | A tune's opening note can get merged into the following beam group. Left as a known, undocumented-upstream, purely-cosmetic quirk — no workaround attempted. |

All three were root-caused by bisecting against the actual library source (installed in
`node_modules` / the `music21` package), not guessed from behavior alone — each report
includes the specific function/line in the vendored source that looks responsible, as a
starting point for whoever picks up the fix upstream.
