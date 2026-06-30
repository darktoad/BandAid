#!/usr/bin/env python3
"""Lightweight song processor: lead sheet (ABC or MusicXML) -> canonical melody+chords MusicXML.

The *right-sized* processor for plain lead sheets. It does NOT arrange parts, optimize
fingerings, or build tab — that heavier work lives in the separate tune-arranger skill and
is not needed to get a tune into the app (the chord-changes view renders the melody staff +
chord symbols and sweeps the playhead over them).

Input can be either:
  * ABC      — from a photo via Claude OMR, or
  * MusicXML — .xml / .musicxml / .mxl (e.g. a Soundslice OMR export), normalized here.

Per the lyrics-and-notes design, a song also carries:
  * a short performance NOTE (audience banter) -> manifest `notes`, supplied via --notes, and
  * optional LYRICS as a ChordPro sidecar      -> <id>.chordpro + content.hasLyrics, via --lyrics.
Both are authored by hand (the toolkit never invents them); the processor just folds them
into the manifest entry and places the sidecar.

Usage:
  python3 abc_to_song.py <input.(abc|xml|musicxml|mxl)> <song-id> <out-dir>
                         [--notes "<audience banter>"] [--lyrics <file.chordpro>]

Prints a JSON manifest entry on stdout; writes <out-dir>/<song-id>.musicxml (and copies the
ChordPro to <out-dir>/<song-id>.chordpro when --lyrics is given). Exits non-zero (with a
report) if any measure's duration doesn't match the meter — that catches the "impossible
durations" class of OMR error without needing to listen. Pitch accuracy still needs the
render+listen loop in the app.
"""
import sys, json, argparse, shutil
from pathlib import Path
from music21 import converter, instrument, meter, harmony


def detect_format(path):
    """ABC vs MusicXML by extension; Soundslice exports use a bare .xml."""
    return 'musicxml' if Path(path).suffix.lower() in ('.xml', '.musicxml', '.mxl') else 'abc'


def main():
    ap = argparse.ArgumentParser(
        description='Lead sheet (ABC or MusicXML) -> canonical MusicXML + a library.json entry.')
    ap.add_argument('input', help='Source lead sheet: .abc or .xml/.musicxml/.mxl')
    ap.add_argument('song_id', help='Stable song id (the file becomes <song-id>.musicxml)')
    ap.add_argument('out_dir', help='Output directory (usually public/songs)')
    ap.add_argument('--notes', default=None,
                    help='Short audience-facing performance note (-> manifest `notes`). '
                         'Banter: what the song is about, its era, trivia, a relatable theme. '
                         'NOT the key or playing tips.')
    ap.add_argument('--lyrics', default=None,
                    help='Path to a ChordPro lyrics sidecar; copied to <out-dir>/<song-id>.chordpro '
                         'and flips content.hasLyrics.')
    args = ap.parse_args()

    score = converter.parse(args.input, format=detect_format(args.input))

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
    title = (score.metadata.title if score.metadata and score.metadata.title else args.song_id)
    has_chords = len(list(part.recurse().getElementsByClass(harmony.ChordSymbol))) > 0

    # Played running time for ONE pass through the chart (written repeats expanded), at the
    # chart tempo. Lets the set list show expected set length without parsing every MusicXML
    # at browse time. Bands often play multiple passes — this is a single pass.
    try:
        total_ql = score.expandRepeats().duration.quarterLength
    except Exception:
        total_ql = score.duration.quarterLength
    duration_sec = round(total_ql * 60.0 / tempo) if tempo else 0

    out_path = f"{args.out_dir}/{args.song_id}.musicxml"
    score.write('musicxml', fp=out_path)

    content = {"hasMelody": True, "hasChords": has_chords, "hasTab": False}

    # Lyrics sidecar: authored separately as ChordPro; the processor just places + flags it.
    lyrics_out = None
    if args.lyrics:
        lyrics_out = f"{args.out_dir}/{args.song_id}.chordpro"
        shutil.copyfile(args.lyrics, lyrics_out)
        content["hasLyrics"] = True

    entry = {
        "id": args.song_id, "title": title,
        "defaultKey": {"fifths": fifths, "mode": mode, "tonalCenter": tonic.replace('-', 'b')},
        "defaultTempoBpm": tempo, "timeSignature": ts_str, "durationSec": duration_sec,
    }
    # Performance note (short audience banter; never the key or fingering — see the spec).
    if args.notes:
        entry["notes"] = args.notes
    entry["content"] = content
    entry["parts"] = [{"instrument": "Fiddle", "notationType": "notation"}]

    print(json.dumps({"entry": entry, "out": out_path, "lyrics_out": lyrics_out,
                      "measures": len(list(part.getElementsByClass('Measure'))),
                      "bad_bars": bad}, indent=2))
    sys.exit(1 if bad else 0)


if __name__ == '__main__':
    main()
