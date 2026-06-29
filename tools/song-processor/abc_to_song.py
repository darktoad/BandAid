#!/usr/bin/env python3
"""Lightweight song processor: ABC (melody + chords) -> canonical melody+chords MusicXML.

This is the *right-sized* processor for plain lead sheets: it does NOT arrange parts,
optimize fingerings, or build tab — that heavier work lives in the separate tune-arranger
skill and is not needed to get a tune into the app (the chord-changes view renders the
melody staff + chord symbols and the playhead over them).

Usage:  python3 abc_to_song.py <input.abc> <song-id> <out-dir>
Prints a JSON manifest entry on stdout; writes <out-dir>/<song-id>.musicxml.
Exits non-zero (with a report) if any measure's duration doesn't match the meter —
that catches the "impossible durations" class of OMR error without needing to listen.
"""
import sys, json
from fractions import Fraction
from music21 import converter, instrument, meter, harmony

def main(abc_path, song_id, out_dir):
    score = converter.parse(abc_path, format='abc')

    part = score.parts[0]
    part.partName = 'Fiddle'
    part.insert(0, instrument.Violin())

    # --- Bar-duration validation (no ear needed) ---
    ts = part.recurse().getElementsByClass(meter.TimeSignature).first()
    bad = []
    for m in part.getElementsByClass('Measure'):
        bar_len = ts.barDuration.quarterLength if ts else None
        # Skip pickup/anacrusis measures (music21 marks them padAsAnacrusis or m.number==0).
        if m.number == 0 or getattr(m, 'paddingLeft', 0):
            continue
        if bar_len and abs(m.duration.quarterLength - bar_len) > 1e-6:
            bad.append((m.number, float(m.duration.quarterLength), float(bar_len)))

    # --- Metadata for the manifest ---
    k = score.analyze('key') if not part.recurse().getElementsByClass('KeySignature') else None
    ks = part.recurse().getElementsByClass('KeySignature').first()
    key_obj = score.recurse().getElementsByClass('Key').first()
    fifths = ks.sharps if ks else (key_obj.sharps if key_obj else 0)
    tonic = key_obj.tonic.name if key_obj else (k.tonic.name if k else 'C')
    mode = (key_obj.mode if key_obj else (k.mode if k else 'major')) or 'major'
    mm = part.recurse().metronomeMarkBoundaries()
    tempo = int(round(mm[0][2].number)) if mm and mm[0][2].number else 0
    ts_str = f"{ts.numerator}/{ts.denominator}" if ts else "4/4"
    title = (score.metadata.title if score.metadata and score.metadata.title else song_id)
    has_chords = len(list(part.recurse().getElementsByClass(harmony.ChordSymbol))) > 0

    # Played running time for ONE pass through the chart (written repeats expanded), at
    # the chart tempo. Lets the set list show expected set length without parsing every
    # MusicXML at browse time. Bands often play multiple passes — this is a single pass.
    try:
        total_ql = score.expandRepeats().duration.quarterLength
    except Exception:
        total_ql = score.duration.quarterLength
    duration_sec = round(total_ql * 60.0 / tempo) if tempo else 0

    out_path = f"{out_dir}/{song_id}.musicxml"
    score.write('musicxml', fp=out_path)

    entry = {
        "id": song_id, "title": title,
        "defaultKey": {"fifths": fifths, "mode": mode, "tonalCenter": tonic.replace('-', 'b')},
        "defaultTempoBpm": tempo, "timeSignature": ts_str, "durationSec": duration_sec,
        "content": {"hasMelody": True, "hasChords": has_chords, "hasTab": False},
        "parts": [{"instrument": "Fiddle", "notationType": "notation"}],
    }
    print(json.dumps({"entry": entry, "out": out_path,
                      "measures": len(list(part.getElementsByClass('Measure'))),
                      "bad_bars": bad}, indent=2))
    sys.exit(1 if bad else 0)

if __name__ == '__main__':
    main(*sys.argv[1:4])
