import { describe, it, expect } from 'vitest';
import stonesRag from '../../public/songs/stones-rag.musicxml?raw';
import { parseChordTimeline, chordsForBar } from './chordTimeline';

// A 4/4 score (divisions=4 → quarter note = 4 divisions):
//  bar 1: C at beat 1, four quarter notes
//  bar 2: no harmony (C carries)
//  bar 3: F at beat 1, then G at beat 3 (after two quarters)
//  bar 4: a redundant C twice in the same bar (must collapse to one)
const note = (dur: number) => `<note><pitch><step>C</step><octave>5</octave></pitch><duration>${dur}</duration></note>`;
const synthetic = `
<score-partwise><part>
  <measure number="1">
    <attributes><divisions>4</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
    <harmony><root><root-step>C</root-step></root><kind>major</kind></harmony>
    ${note(4)}${note(4)}${note(4)}${note(4)}
  </measure>
  <measure number="2">
    ${note(4)}${note(4)}${note(4)}${note(4)}
  </measure>
  <measure number="3">
    <harmony><root><root-step>F</root-step></root><kind>major</kind></harmony>
    ${note(4)}${note(4)}
    <harmony><root><root-step>G</root-step></root><kind>major</kind></harmony>
    ${note(4)}${note(4)}
  </measure>
  <measure number="4">
    <harmony><root><root-step>C</root-step></root><kind>major</kind></harmony>
    ${note(4)}${note(4)}
    <harmony><root><root-step>C</root-step></root><kind>major</kind></harmony>
    ${note(4)}${note(4)}
  </measure>
</part></score-partwise>`;

describe('parseChordTimeline', () => {
  it('reads onsets with 1-based bar + beat from harmony positions', () => {
    const t = parseChordTimeline(synthetic);
    expect(t).toEqual([
      { bar: 1, beat: 1, label: 'C', root: 'C', kind: 'major' },
      { bar: 3, beat: 1, label: 'F', root: 'F', kind: 'major' },
      { bar: 3, beat: 3, label: 'G', root: 'G', kind: 'major' },
      { bar: 4, beat: 1, label: 'C', root: 'C', kind: 'major' },
      { bar: 4, beat: 3, label: 'C', root: 'C', kind: 'major' },
    ]);
  });

  it('formats accidentals, minor, and seventh labels', () => {
    const xml = `<score-partwise><part><measure number="1">
      <attributes><divisions>4</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
      <harmony><root><root-step>F</root-step><root-alter>1</root-alter></root><kind>minor</kind></harmony>
      <harmony><root><root-step>D</root-step></root><kind>dominant</kind></harmony>
      <harmony><root><root-step>G</root-step></root><kind>major</kind><bass><bass-step>B</bass-step></bass></harmony>
    </measure></part></score-partwise>`;
    expect(parseChordTimeline(xml).map((o) => o.label)).toEqual(['F#m', 'D7', 'G/B']);
  });
});

describe('chordsForBar', () => {
  const t = parseChordTimeline(synthetic);

  it('shows the bar-start chord at beat 1', () => {
    expect(chordsForBar(t, 1)).toEqual([{ beat: 1, label: 'C', root: 'C', kind: 'major' }]);
  });

  it('re-shows a carried chord at the start of a new bar', () => {
    expect(chordsForBar(t, 2)).toEqual([{ beat: 1, label: 'C', root: 'C', kind: 'major' }]);
  });

  it('shows multiple chords in a bar at their beats', () => {
    expect(chordsForBar(t, 3)).toEqual([
      { beat: 1, label: 'F', root: 'F', kind: 'major' },
      { beat: 3, label: 'G', root: 'G', kind: 'major' },
    ]);
  });

  it('carries the last chord of a multi-chord bar into the next', () => {
    expect(chordsForBar(t, 4)).toEqual([{ beat: 1, label: 'C', root: 'C', kind: 'major' }]);
  });

  it('collapses the same chord repeated within a bar', () => {
    // bar 4 has C at beat 1 and C again at beat 3 → one entry.
    expect(chordsForBar(t, 4).filter((c) => c.label === 'C')).toHaveLength(1);
  });

  it('returns an empty list for a bar before any chord', () => {
    const noChords = parseChordTimeline(
      `<score-partwise><part><measure number="1"><attributes><divisions>4</divisions></attributes>${note(4)}</measure></part></score-partwise>`,
    );
    expect(chordsForBar(noChords, 1)).toEqual([]);
  });
});

describe('parseChordTimeline on real song data', () => {
  it('reads Stone\'s Rag: C from bar 1, F from bar 3, G from bar 5', () => {
    const t = parseChordTimeline(stonesRag);
    expect(t[0]).toEqual({ bar: 1, beat: 1, label: 'C', root: 'C', kind: 'major' });
    expect(t.some((o) => o.label === 'F' && o.bar === 3)).toBe(true);
    expect(t.some((o) => o.label === 'G' && o.bar === 5)).toBe(true);
    // Every onset lands on beat 1 in this arrangement (one chord per bar).
    expect(t.every((o) => o.beat === 1)).toBe(true);
  });

  it('carries the chord across bars with no harmony of their own', () => {
    const t = parseChordTimeline(stonesRag);
    expect(chordsForBar(t, 2)).toEqual([{ beat: 1, label: 'C', root: 'C', kind: 'major' }]);
  });
});
