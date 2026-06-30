# Song processor (lightweight)

The **right-sized** processor for plain lead sheets: **a lead sheet (ABC *or* MusicXML) →
canonical melody+chords MusicXML**, plus the song's manifest entry. It deliberately does
*not* arrange parts, optimize fingerings, or build tab — that heavier work lives in the
separate `tune-arranger` skill and isn't needed to get a tune into the app (the
chord-changes view renders the melody staff + chord symbols and sweeps the playhead over
them).

Every song also carries two pieces of human-authored context (see
[the lyrics & notes design](../../docs/superpowers/specs/2026-06-29-lyrics-and-notes-design.md)):
a short **performance note** and, for sung tunes, **ChordPro lyrics**. The processor folds
both into the output (it never invents them).

## Usage

```
python3 abc_to_song.py <input.(abc|xml|musicxml|mxl)> <song-id> <out-dir> \
        [--notes "<audience banter>"] [--lyrics <file.chordpro>]
```

- **Input** is auto-detected by extension: `.abc` → ABC; `.xml` / `.musicxml` / `.mxl` →
  MusicXML (e.g. a Soundslice OMR export, normalized through music21).
- `--notes` sets the manifest `notes` string (see the rules below).
- `--lyrics` copies a ChordPro file to `<out-dir>/<song-id>.chordpro` and sets
  `content.hasLyrics`.

Writes `<out-dir>/<song-id>.musicxml` (+ the `.chordpro` when `--lyrics` is given) and
prints a `library.json` manifest entry on stdout. It **validates every bar's duration
against the meter** and exits non-zero (listing the offending bars) if any don't add up —
this catches the "impossible durations" class of OMR error *without needing to listen*.
Requires `music21`.

## Lyrics & performance notes (every song)

**Performance note (all songs) → manifest `notes`.** One or two sentences of *audience*
banter: what the song is about, the era it came from, a hook of trivia, a theme that still
lands. **Not** the key, time signature, or fingering tips — lay listeners don't care.
Source it accurately (the tune's real history, or a footnote on the source sheet), don't
invent. Pass it via `--notes`, or add it to the manifest entry by hand.

**Lyrics (sung tunes only) → `<id>.chordpro` + `content.hasLyrics`.** Author the
chord-over-lyric sheet in **ChordPro**: `[Chord]` inline, sections via
`{start_of_verse[: label]}` / `{start_of_chorus}` / `{end_of_verse}` etc. The app's parser
ignores unknown directives. Instrumentals get no sidecar. Example:
[`public/songs/wabash-cannonball.chordpro`](../../public/songs/wabash-cannonball.chordpro).

## Pipeline & the verification loop

```
photo ──[Claude OMR]──► ABC ─────────┐
        (or)                          ├─[this processor]─► canonical MusicXML ──► app
photo ──[Soundslice OMR]──► MusicXML ─┘                  (+ <id>.chordpro, manifest)   │
                                                                                       │
                       hand-authored note (--notes) + lyrics (--lyrics) ───────────────┤
                                                                                       │
                                          play it in the app ◄─────────────────────────┘
                                                                       (the LISTEN step)
```

The OMR step (Claude reading a photo to ABC, **or** Soundslice reading it to MusicXML)
produces *pitches/rhythm/chords*. The processor guarantees the **rhythm** is well-formed.
The one thing neither can do is *hear* the result — so **pitch accuracy is verified by ear
in the app** (the human-in-the-loop half of the loop the unified-music-model spec
describes). Treat every fresh OMR as a draft until it's been played against the source.

**On OMR accuracy:** Claude's by-eye OMR is unreliable for note-dense fiddle tunes.
Soundslice's purpose-built OMR is usually a better starting point for those; its exports
have quirks (varying `divisions`, missing `<mode>`, a `.xml` extension, the occasional
`kind="other"` chord), which this processor normalizes via music21. Either way, the
render+listen loop is mandatory — to correct a tune, edit its source (`.abc`) or re-export
from Soundslice and re-run the processor.

## Verification status of the bundled tunes

All four canonical files are early Claude-OMR drafts and are **not yet note-accurate** —
they need re-transcription (Soundslice OMR recommended) and an in-app listen pass.

| Tune | Source | Status |
|------|--------|--------|
| Stone's Rag | photo → Claude ABC | **Re-transcribe + verify by ear** |
| East Tennessee Blues | photo → Claude ABC | **Re-transcribe + verify by ear** (B part was already a flagged OMR draft) |
| Wabash Cannonball | photo → Claude ABC | **Re-transcribe + verify by ear**; lyrics authored ✓ |
| Old Blue | photo → Claude ABC | **Re-transcribe + verify by ear**; instrumental (no lyrics) |

ABC sources live in `abc/`; prior Soundslice exports are in
`../../docs/reference/samples/soundslice/`. To correct a tune, fix its source and re-run
the processor, then verify by ear in the app.
