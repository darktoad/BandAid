import { describe, expect, it } from 'vitest';
import {
  noteToPitchClass,
  prefersFlats,
  transposeChordLabel,
  transposedFifths,
  transposeNote,
} from './transposeChord';

describe('noteToPitchClass', () => {
  it('parses naturals, sharps, flats, and unicode accidentals', () => {
    expect(noteToPitchClass('C')).toBe(0);
    expect(noteToPitchClass('F#')).toBe(6);
    expect(noteToPitchClass('Bb')).toBe(10);
    expect(noteToPitchClass('A♭')).toBe(8);
    expect(noteToPitchClass('C♯')).toBe(1);
    expect(noteToPitchClass('B##')).toBe(1);
    expect(noteToPitchClass('Dbb')).toBe(0);
  });
  it('rejects non-notes', () => {
    expect(noteToPitchClass('H')).toBeNull();
    expect(noteToPitchClass('N.C.')).toBeNull();
    expect(noteToPitchClass('Am')).toBeNull(); // trailing suffix ≠ bare note
    expect(noteToPitchClass('')).toBeNull();
  });
});

describe('transposeNote', () => {
  it('transposes with sharp spelling', () => {
    expect(transposeNote('C', 2, false)).toBe('D');
    expect(transposeNote('G', 3, false)).toBe('A#');
    expect(transposeNote('B', 1, false)).toBe('C'); // wraps the octave
  });
  it('transposes with flat spelling', () => {
    expect(transposeNote('G', 3, true)).toBe('Bb');
    expect(transposeNote('C', -2, true)).toBe('Bb');
    expect(transposeNote('D', -4, true)).toBe('Bb');
  });
  it('passes unparseable names through', () => {
    expect(transposeNote('N.C.', 2, false)).toBe('N.C.');
  });
});

describe('transposeChordLabel', () => {
  it('moves the root and keeps the quality suffix', () => {
    expect(transposeChordLabel('G', 2, false)).toBe('A');
    expect(transposeChordLabel('Am', 2, false)).toBe('Bm');
    expect(transposeChordLabel('D7', 5, false)).toBe('G7');
    expect(transposeChordLabel('Cmaj7', 1, false)).toBe('C#maj7');
  });
  it('does not mistake suffix letters for accidentals', () => {
    // The "b" in m7b5 belongs to the suffix, not the root.
    expect(transposeChordLabel('Bm7b5', 1, false)).toBe('Cm7b5');
    expect(transposeChordLabel('Bbm7b5', 1, false)).toBe('Bm7b5');
  });
  it('transposes a slash bass', () => {
    expect(transposeChordLabel('G/B', 2, false)).toBe('A/C#');
    expect(transposeChordLabel('G/B', 3, true)).toBe('Bb/D');
    expect(transposeChordLabel('C/E', -1, true)).toBe('B/Eb');
  });
  it('is the identity at 0 (and full-octave) semitones', () => {
    expect(transposeChordLabel('F#m', 0, true)).toBe('F#m');
    expect(transposeChordLabel('F#m', 12, true)).toBe('F#m');
  });
  it('passes non-chord labels through', () => {
    expect(transposeChordLabel('N.C.', 2, false)).toBe('N.C.');
  });
});

describe('transposedFifths / prefersFlats', () => {
  it('walks the circle of fifths per semitone', () => {
    expect(transposedFifths(0, 0)).toBe(0); // C stays C
    expect(transposedFifths(0, 2)).toBe(2); // C → D
    expect(transposedFifths(1, 2)).toBe(3); // G → A
    expect(transposedFifths(0, 1)).toBe(-5); // C → Db (5 flats)
    expect(transposedFifths(1, -2)).toBe(-1); // G → F (1 flat)
    expect(transposedFifths(0, 6)).toBe(6); // tritone lands on F# (6 sharps)
  });
  it('prefers flats exactly when the target key is a flat key', () => {
    expect(prefersFlats(0, 2)).toBe(false); // C → D
    expect(prefersFlats(0, 1)).toBe(true); // C → Db
    expect(prefersFlats(1, 3)).toBe(true); // G → Bb
    expect(prefersFlats(1, 2)).toBe(false); // G → A
  });
});
