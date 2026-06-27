---
name: tune-arranger
description: >
  Turn traditional / public-domain fiddle tunes into Soundslice-ready multi-part
  MusicXML (fiddle in standard notation; guitar, ukulele, and bass in tablature)
  and a printable chartbook PDF with a string-map legend. Handles re-entrant
  high-G ukulele correctly, auto-derives a root-fifth bass from chord symbols,
  and works for 4/4 reels, 6/8 jigs, and verse/chorus songs. Use whenever adding
  a tune to the ensemble set, regenerating the chartbook, or producing practice
  files for Soundslice.
---

# Tune Arranger

A small toolkit for taking a melody+chords tune (as ABC) and producing:

1. **`<tune>_multipart.musicxml`** — four synced parts (Fiddle = standard notation;
   Guitar, Ukulele, Bass = tab), ready to import into Soundslice one at a time.
2. **A chartbook PDF** — a string-map legend page, every tune engraved, and a
   chords-only page for any copyrighted tune.

It encodes the conventions and gotchas worked out for this specific ensemble
(guitar + high-G uke + U-Bass + fiddle), so re-runs stay consistent.

## When to use

- Adding a new tune to the set → write its ABC, run `arrange.build(...)`, then rebuild the chartbook.
- Re-generating the chartbook PDF after edits.
- Producing per-tune MusicXML to import into Soundslice (melody/notation + playable tab).

## Inputs

One ABC string per tune **with chord symbols in quotes**, e.g.:

```
X:1
T:Soldier's Joy
M:4/4
L:1/8
K:D
FG|"D"AFDF AFDF|A2 d2 d2 cB|"D"AFDF AFDF|"A"G2 E2 E2 FG| ... :|
```

Source canonical settings from **thesession.org** / **tunearch.org** (clean ABC,
chord-annotated versions exist on natunelist.net and sessionite). Strip Irish
ornament marks (`~`, `T`) before parsing — music21 chokes on some of them.
Keep `(3...` triplets, broken rhythm `>` `<`, repeats `|: :|`, and `|1 |2` endings;
those parse fine.

## Pipeline

```
ABC (melody + chord symbols)
   │  music21.converter.parse(abc, format='abc')
   ▼
melody Part  ──► deep-copy ×4
   ├─ Fiddle : TrebleClef, concert pitch, keep chord symbols
   ├─ Guitar : transpose -12 (flatpicking register); fingering via DP optimizer, tab (EADGBE)
   ├─ Ukulele: octave-fold into window; fingering via campanella-weighted DP optimizer, tab (high-G g C E A)
   └─ Bass   : replace notes with auto root-fifth from chords, tab (EADG)
   ▼
score.write('musicxml')  ──►  patch_staff_details()  (adds <staff-details>: lines + tunings)
   ▼
verovio → SVG → cairosvg(PNG, background_color="white") → PIL letter pages → PDF
```

Run it:

```bash
pip install music21 verovio cairosvg matplotlib pillow --break-system-packages
python3 scripts/arrange.py          # builds out/<key>_multipart.musicxml for every tune in tunes_example.py
python3 scripts/legend.py           # builds the string-map legend page
python3 scripts/make_chartbook.py   # assembles the chartbook PDF
```

To add a tune: add its ABC to `tunes_example.py`, add a row to `meta` in
`arrange.py` and to `TUNES` in `chartbook_tunes.py`, re-run.

## Instrument conventions (KEEP CONSISTENT)

Tab is ordered by **string number, not pitch**: top line = string 1, bottom line =
highest-numbered string. `0` = open, other numbers = fret.

| Instrument | Tuning (string 1→N) | Top line | Bottom line | Notes |
|---|---|---|---|---|
| Fiddle | G D A E | — | — | standard notation only, concert pitch |
| Guitar | e B G D A E | high e (E4) | low E (E2) | melody written **one octave down** (flatpicking) |
| Ukulele | A E C **g** | A (A4) | **high g (G4)** | **re-entrant**: bottom line sounds *higher* than the C/E lines above it |
| Bass (U-Bass) | G D A E | G (G2) | low E (E1) | root-fifth, standard EADG |

### The high-G ukulele is the tricky part
- String 4 (the g string) is the **bottom tab line** but is **high-pitched (G4)** — it is **not** the lowest note. This confuses everyone; the legend page calls it out explicitly.
- The uke's playable melodic window in low position (frets 0–12) is roughly **C4 (60) … A5 (81)**.
- Fiddle tunes routinely exceed that (low notes below C4, high B-parts above A5). `fold_uke()` octave-folds **each** note into the window, picking the octave closest to the previous note so the line stays smooth and playable instead of running off the neck (e.g., Irish Washerwoman's B part would otherwise hit fret 14).
- Consequence: the uke line may sit an octave off the fiddle in places. That is expected and idiomatic for re-entrant uke. For very high tunes the uke A-part can still reach ~fret 12 — fine to treat as "up the neck," or play rhythm there.

### Bass
- `make_bass()` reads the **chord symbols** off the melody and writes an alternating root–fifth: root on strong beats, perfect-fifth (root+7) on the off-beats; follows mid-bar chord changes.
- 4/4 → four quarter notes/bar; **6/8 → two dotted-quarters/bar** (beats 1 and 4). Pickup/partial bars → a rest (bass enters on the downbeat).
- Roots are placed low: `root = 28 + ((pitchclass - 4) % 12)` → E1..D#2 register.

## Hard-won learnings / gotchas

- **LilyPond is import-only for our purposes.** It engraves beautiful PDF/tab but does **not** export usable MusicXML (`musicxml2ly` goes MusicXML→LilyPond, not back). To get into Soundslice, go **ABC → music21 → MusicXML**, or **MIDI → MuseScore → MusicXML**. Don't try to round-trip the old LilyPond chartbook sources into Soundslice.
- **music21 can emit tab.** Use `clef.TabClef()` on the first measure + per-note `articulations.StringIndication` (string number) and `articulations.FretIndication` (fret). It does **not** write `<staff-details>` (line count + tuning), so **post-process the XML** to inject `<staff-details><staff-lines>N</staff-lines>` and `<staff-tuning>` per part (`patch_staff_details`).
- **MusicXML `<staff-tuning line="1">` is the BOTTOM line.** List tunings bottom→top. (Guitar line1=E2; uke line1=high g G4; bass line1=E1.)
- **Capture a measure's bar length BEFORE clearing its notes.** `measure.duration.quarterLength` collapses to 0 once you remove the notes, which silently turns a pickup test true and writes a zero-duration rest → `"Cannot convert durations without types"`. Read `orig = m.duration.quarterLength` first.
- **Rendering for the PDF:** verovio renders tab MusicXML correctly; convert with `cairosvg.svg2png(..., background_color="white")` or the notation flattens to a **black box**. The verovio metronome glyph renders as an empty box through cairosvg — **strip `<direction>` elements containing `<metronome>`** from the render copy (keep them in the Soundslice file; fold tempo into the page caption instead).
- **Fingering is a path-optimization problem, not a per-note choice.** Picking the lowest fret for each note independently piles everything onto one string and forces constant position shifts. Use the DP optimizer in `optimize.py` (see the Fingering section).
- **Validate visually, every time.** Render each result with verovio and eyeball it; structural bugs (wrong clef from low range, octave explosions, broken repeats) don't show up in measure counts.

## Fingering & playability (the optimizer)

`optimize.py` assigns string/fret for the fretted parts with a Viterbi/DP pass that
minimizes **hand motion across the whole phrase** instead of per-note fret. It encodes
standard string-instrument pedagogy:

- **Position playing** — keep the hand in one 4–5 fret span; distribute notes across
  all strings within it; shift only when forced.
- **Campanella** (re-entrant uke superpower) — reward placing consecutive notes on
  *different* strings so the line crosses strings (ring-y, harp-like) while the hand
  stays put. This is why the uke weights have a strong negative `cross` cost.
- **Punish position shifts** — `jump` adds a nonlinear penalty for fret moves beyond
  the ~4-fret hand span, so the optimizer avoids big leaps even at the cost of more
  small in-position moves. Capping `maxfret` (uke = 9) forces low position.
- **Octave in service of position** — for the uke, octave candidates (±12) are part
  of the search (`allow_octave=True`), so a high note can drop an octave when that keeps
  the phrase in one position; `oct` weight keeps it faithful to the contour otherwise.
- **Open strings as pivots** — small bonus for open strings (free, ringing, good shift points).

Weights (in `arrange.py`):
```
UKE_W  = shift 1.0, jump 2.5, cross -0.7,  same_slide 0.9, high 0.10, open -0.4,  oct 0.45  # campanella-forward
GTR_W  = shift 1.0, jump 2.0, cross -0.15, same_slide 0.4, high 0.12, open -0.25, oct 0     # cleaner position blocks
BASS_W = shift 1.0, jump 2.0, cross 0.0,   same_slide 0.5, high 0.06, open -0.3,  low 0.03  # low, parked root-fifth
```
Guitar uses `allow_octave=False`, `maxfret=10` (keep the flatpicking register, stay ≤ ~9th fret);
uke uses `allow_octave=True`, `maxfret=9`, `window=(60,81)`. **The bass also goes through the
optimizer** (`optimize_bass`): root on strong beats, fifth on weak, with register / string / fret
chosen for a low, parked, ergonomic shape (it will often land entirely on open strings). So all
three fretted parts apply the same position principle; only the fiddle is plain notation.

Tuning knob: raise `cross` magnitude for more campanella; raise `jump`/lower `maxfret` for
tighter low position; raise `oct` to hug the original octave more closely. `optimize.metrics()`
reports total fret-travel, count of >3-fret shifts, max fret, % on string 1, and string-crossings —
use it to compare settings. (Switching uke from greedy to this optimizer cut total hand-travel
roughly in half and dropped big shifts to 0–2 per tune while spreading notes off string 1.)

Possible extension: emit suggested left-hand finger numbers (1–4) and position/shift markers
from the chosen path to reinforce technique on the page.



- Import format is **MusicXML** (or native Guitar Pro). No ABC or MIDI importer — MIDI must hop through MuseScore.
- Each part becomes a mute/solo/volume channel on one playhead; fiddle/bass show notation, guitar/uke show tab. Import one file at a time on the Plus plan (bulk ZIP is Teacher-plan only).
- Sharing: one paid Plus plan for the creator; bandmates open a secret link in a browser, no account or payment needed.

## Copyright

Only arrange **public-domain** tunes. Keep anything still under copyright (e.g.,
*Orange Blossom Special*, Ervin T. Rouse) as a **chords-and-structure page only** —
no melody transcription, no shared full notation. See
`extra_chordpage_example.py` for the chords-only page pattern.

## Files

- `scripts/arrange.py` — the builder (`build()`, `make_bass()`, `fold_uke()`, `fret_part()`, `patch_staff_details()`).
- `scripts/optimize.py` — the position-aware, campanella-weighted fingering optimizer (`optimize()`, `metrics()`).
- `scripts/tunes_example.py` — the eight-tune ABC library (seven arranged + OBS handled separately).
- `scripts/legend.py` — the string-map legend page.
- `scripts/make_chartbook.py` + `scripts/chartbook_tunes.py` — render + assemble the PDF.
- `scripts/extra_chordpage_example.py` — the OBS chords-only page (copyright-safe pattern).
