# music21: `Slur.write('musicxml')` drops interior `continue` notations on a 3+-note slur

**Project:** [cuthbertLab/music21](https://github.com/cuthbertLab/music21)
**Suggested title:** MusicXML writer drops interior slur `continue` notations for slurs spanning 3+ notes
**Environment:** music21 10.5.0, Python 3.14

## Summary

A slur that spans three or more notes is written back out to MusicXML with only its
**first** and **last** note tagged (`type="start"` / `type="stop"`). The interior note(s)
— which should carry `type="continue"` — silently lose their slur notation entirely. The
note data itself (pitch, duration, etc.) is unaffected; only the slur is truncated. Any
notation renderer that trusts the written MusicXML draws the slur arc two notes shorter
than the original.

This reproduces with a **bare `parse` → `write` round-trip and no other music21 API calls**,
so it isn't a side effect of any transformation — just importing and re-exporting a file
loses the information.

## Steps to reproduce

Input (`slur-input.musicxml`) — a single measure, C–D–E–F quarter notes, with an explicit
3-note slur from C to E (D is the `continue` note):

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">
<score-partwise version="4.0">
  <part-list>
    <score-part id="P1"><part-name>Music</part-name></score-part>
  </part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>1</divisions>
        <key><fifths>0</fifths></key>
        <time><beats>4</beats><beat-type>4</beat-type></time>
        <clef><sign>G</sign><line>2</line></clef>
      </attributes>
      <note>
        <pitch><step>C</step><octave>4</octave></pitch>
        <duration>1</duration>
        <type>quarter</type>
        <notations><slur number="1" type="start"/></notations>
      </note>
      <note>
        <pitch><step>D</step><octave>4</octave></pitch>
        <duration>1</duration>
        <type>quarter</type>
        <notations><slur number="1" type="continue"/></notations>
      </note>
      <note>
        <pitch><step>E</step><octave>4</octave></pitch>
        <duration>1</duration>
        <type>quarter</type>
        <notations><slur number="1" type="stop"/></notations>
      </note>
      <note>
        <pitch><step>F</step><octave>4</octave></pitch>
        <duration>1</duration>
        <type>quarter</type>
      </note>
    </measure>
  </part>
</score-partwise>
```

Python:

```python
from music21 import converter
score = converter.parse('slur-input.musicxml', format='musicxml')
score.write('musicxml', fp='slur-output.musicxml')
```

## Expected

`slur-output.musicxml` should tag all three notes of the slur: C (`start`), D (`continue`),
E (`stop`).

## Actual

D's slur notation is dropped entirely. Inspecting the output:

```
C4: slurs=[('start', '1')]
D4: slurs=[]                 <-- expected [('continue', '1')]
E4: slurs=[('stop', '1')]
F4: slurs=[]
```

## Real-world impact

Found while re-processing fiddle-tune transcriptions (Soundslice MusicXML exports) through
music21 for a solo-practice app. Every slur spanning 3+ notes in four different tunes lost
its interior note(s) on write — 23 slur notations across the set. The fix we applied
downstream (not a music21 patch) walks the written file and re-adds the missing `continue`
tags between each now-adjacent `start`/`stop` pair, since the interior notes are still
physically present in the output — only their slur tag is missing.

## Suggested root cause (not yet verified against music21 internals)

Likely the `Slur`/`Spanner` → MusicXML export path only serializes the spanner's first and
last component elements, rather than iterating and tagging every element the spanner spans.
