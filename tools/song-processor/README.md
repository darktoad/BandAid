# Song processor (lightweight)

The **right-sized** processor for plain lead sheets: **ABC (melody + chords) → canonical
melody+chords MusicXML**. It deliberately does *not* arrange parts, optimize fingerings,
or build tab — that heavier work lives in the separate `tune-arranger` skill and isn't
needed to get a tune into the app (the chord-changes view renders the melody staff +
chord symbols and sweeps the playhead over them).

## Usage

```
python3 abc_to_song.py <input.abc> <song-id> <out-dir>
```

Writes `<out-dir>/<song-id>.musicxml` and prints a `library.json` manifest entry.
It **validates every bar's duration against the meter** and exits non-zero (listing the
offending bars) if any don't add up — this catches the "impossible durations" class of
OMR error *without needing to listen*. Requires `music21`.

## Pipeline & the verification loop

```
photo ──[Claude OMR]──► ABC (melody+chords) ──[this processor]──► MusicXML ──► app
                                                                         │
                                          play it in the app ◄───────────┘  (the LISTEN step)
```

Claude does the OMR (pitch/rhythm/chords from the photo). The processor guarantees the
**rhythm** is well-formed. The one thing neither can do is *hear* the result — so **pitch
accuracy is verified by ear in the app** (the human-in-the-loop half of the loop the
unified-music-model spec describes).

## Verification status of the bundled tunes

| Tune | Source | Status |
|------|--------|--------|
| Stone's Rag | photo → ABC | **Verified** note-for-note (2026-06-25 acquisition test) |
| East Tennessee Blues | photo → ABC | A part verified; **B part is an OMR draft — verify by ear** |
| Wabash Cannonball | photo → ABC | **OMR draft — verify by ear** (chords/form follow the photo) |
| Old Blue | photo → ABC | **OMR draft — verify by ear** (chords/form follow the photo) |

ABC sources live in `abc/`. To correct a tune, edit its `.abc` and re-run the processor.
