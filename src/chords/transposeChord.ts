/**
 * Pure chord-label transposition, shared by every surface that shows a chord name.
 *
 * The notes themselves transpose inside alphaTab (settings.notation.transpositionPitches
 * moves notation + playback), but chord labels are plain text in three independent
 * places — the score model's chord names (sheet symbols), the MusicXML-parsed chord
 * timeline (overlay), and the ChordPro lyrics — so each display transposes its labels
 * with these helpers.
 *
 * Spelling: the caller picks sharps or flats once per song+transpose (prefer flats when
 * the *target* key signature is a flat key), so "G up 3" reads B♭, not A♯.
 */

const SHARP_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const FLAT_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
const LETTER_PC: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const ALTER: Record<string, number> = { '#': 1, '♯': 1, b: -1, '♭': -1, '##': 2, bb: -2 };

// A note name at the start of a string: letter + optional accidental (ASCII or unicode,
// single or double). Deliberately not anchored at the end so it can lead a chord label.
const ROOT_RE = /^([A-G])(##|bb|[#♯b♭])?/;

/** Pitch class (0–11) of a note name like "C", "F#", "Bb", "A♭" — null if unparseable. */
export function noteToPitchClass(name: string): number | null {
  const m = ROOT_RE.exec(name);
  if (!m || m[0].length !== name.length) return null;
  return (LETTER_PC[m[1]] + (m[2] ? ALTER[m[2]] : 0) + 12) % 12;
}

/** Transpose a bare note name by N semitones; unparseable names pass through. */
export function transposeNote(name: string, semitones: number, preferFlats: boolean): string {
  const pc = noteToPitchClass(name);
  if (pc === null) return name;
  const names = preferFlats ? FLAT_NAMES : SHARP_NAMES;
  return names[(pc + semitones + 120) % 12];
}

/**
 * Transpose a chord label ("G", "Am7", "Bm7b5", "G/B") by N semitones. The root and any
 * slash bass move; the quality suffix is untouched. Labels that don't start with a note
 * (e.g. "N.C.") pass through unchanged, as does a 0-semitone transpose.
 */
export function transposeChordLabel(label: string, semitones: number, preferFlats: boolean): string {
  if (semitones % 12 === 0) return label;
  const m = ROOT_RE.exec(label);
  if (!m) return label;
  const root = transposeNote(m[0], semitones, preferFlats);
  let rest = label.slice(m[0].length);
  // A slash bass is a bare note name after the last "/" — transpose it too.
  const slash = rest.lastIndexOf('/');
  if (slash !== -1) {
    const bass = rest.slice(slash + 1);
    if (noteToPitchClass(bass) !== null) {
      rest = `${rest.slice(0, slash)}/${transposeNote(bass, semitones, preferFlats)}`;
    }
  }
  return root + rest;
}

/**
 * Key signature (fifths, −5…6) after transposing a key of `fifths` by N semitones.
 * Each semitone is +7 on the circle of fifths; normalize into −5 (D♭) … 6 (F♯).
 */
export function transposedFifths(fifths: number, semitones: number): number {
  return ((((fifths + semitones * 7 + 5) % 12) + 12) % 12) - 5;
}

/** Whether transposed labels should spell with flats: true when the target key is flat. */
export function prefersFlats(writtenFifths: number, semitones: number): boolean {
  return transposedFifths(writtenFifths, semitones) < 0;
}
