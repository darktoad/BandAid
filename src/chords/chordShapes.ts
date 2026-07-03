/**
 * Curated guitar + ukulele fingerings for the chord overlay diagrams.
 *
 * A shape is one fret per string, low-to-high (guitar: E A D G B E; ukulele: G C E A):
 *   -1 = muted (x), 0 = open (o), n = press fret n.
 *
 * This covers the chords in the current library (C, F, G, A, D major) plus a common set,
 * including barre/movable shapes for the accidental roots that key transposition produces.
 * `shapeFor` returns null for anything not in the table — callers fall back to name-only,
 * so the overlay degrades gracefully and the table can grow as the library does.
 */

export type Instrument = 'guitar' | 'ukulele';

export interface ChordShape {
  /** Fret per string, low-to-high. -1 = muted, 0 = open. */
  frets: number[];
}

/**
 * Enharmonic spellings of the same pitch class. Transposition spells the label to fit
 * the target key (e.g. F# vs Gb), but the fingering is identical, so shapes are written
 * once under the sharp name and aliased to the flat name for every quality in the table.
 */
const ENHARMONIC: Array<[sharp: string, flat: string]> = [
  ['C#', 'Db'],
  ['D#', 'Eb'],
  ['F#', 'Gb'],
  ['G#', 'Ab'],
  ['A#', 'Bb'],
];

function withFlatAliases(table: Record<string, number[]>): Record<string, number[]> {
  for (const [sharp, flat] of ENHARMONIC) {
    for (const suffix of ['', 'm', '7']) {
      const frets = table[sharp + suffix];
      if (frets) table[flat + suffix] = frets;
    }
  }
  return table;
}

const GUITAR: Record<string, number[]> = withFlatAliases({
  C: [-1, 3, 2, 0, 1, 0],
  D: [-1, -1, 0, 2, 3, 2],
  E: [0, 2, 2, 1, 0, 0],
  F: [1, 3, 3, 2, 1, 1],
  G: [3, 2, 0, 0, 0, 3],
  A: [-1, 0, 2, 2, 2, 0],
  B: [-1, 2, 4, 4, 4, 2],
  'C#': [-1, 4, 6, 6, 6, 4],
  'D#': [-1, 6, 8, 8, 8, 6],
  'F#': [2, 4, 4, 3, 2, 2],
  'G#': [4, 6, 6, 5, 4, 4],
  'A#': [-1, 1, 3, 3, 3, 1],
  Am: [-1, 0, 2, 2, 1, 0],
  Bm: [-1, 2, 4, 4, 3, 2],
  Cm: [-1, 3, 5, 5, 4, 3],
  Dm: [-1, -1, 0, 2, 3, 1],
  Em: [0, 2, 2, 0, 0, 0],
  Fm: [1, 3, 3, 1, 1, 1],
  Gm: [3, 5, 5, 3, 3, 3],
  'C#m': [-1, 4, 6, 6, 5, 4],
  'D#m': [-1, 6, 8, 8, 7, 6],
  'F#m': [2, 4, 4, 2, 2, 2],
  'G#m': [4, 6, 6, 4, 4, 4],
  'A#m': [-1, 1, 3, 3, 2, 1],
  C7: [-1, 3, 2, 3, 1, 0],
  D7: [-1, -1, 0, 2, 1, 2],
  E7: [0, 2, 0, 1, 0, 0],
  F7: [1, 3, 1, 2, 1, 1],
  G7: [3, 2, 0, 0, 0, 1],
  A7: [-1, 0, 2, 0, 2, 0],
  B7: [-1, 2, 1, 2, 0, 2],
  'C#7': [-1, 4, 6, 4, 6, 4],
  'D#7': [-1, 6, 8, 6, 8, 6],
  'F#7': [2, 4, 2, 3, 2, 2],
  'G#7': [4, 6, 4, 5, 4, 4],
  'A#7': [-1, 1, 3, 1, 3, 1],
});

const UKULELE: Record<string, number[]> = withFlatAliases({
  C: [0, 0, 0, 3],
  D: [2, 2, 2, 0],
  E: [4, 4, 4, 2],
  F: [2, 0, 1, 0],
  G: [0, 2, 3, 2],
  A: [2, 1, 0, 0],
  B: [4, 3, 2, 2],
  'C#': [1, 1, 1, 4],
  'D#': [0, 3, 3, 1],
  'F#': [3, 1, 2, 1],
  'G#': [5, 3, 4, 3],
  'A#': [3, 2, 1, 1],
  Am: [2, 0, 0, 0],
  Bm: [4, 2, 2, 2],
  Cm: [0, 3, 3, 3],
  Dm: [2, 2, 1, 0],
  Em: [0, 4, 3, 2],
  Fm: [1, 0, 1, 3],
  Gm: [0, 2, 3, 1],
  'C#m': [1, 4, 4, 4],
  'D#m': [3, 3, 2, 1],
  'F#m': [2, 1, 2, 0],
  'G#m': [4, 3, 4, 2],
  'A#m': [3, 1, 1, 1],
  C7: [0, 0, 0, 1],
  D7: [2, 2, 2, 3],
  E7: [1, 2, 0, 2],
  F7: [2, 3, 1, 0],
  G7: [0, 2, 1, 2],
  A7: [0, 1, 0, 0],
  B7: [2, 3, 2, 2],
  'C#7': [1, 1, 1, 2],
  'D#7': [3, 3, 3, 4],
  'F#7': [3, 4, 2, 4],
  'G#7': [1, 3, 2, 3],
  'A#7': [1, 2, 1, 1],
});

const TABLES: Record<Instrument, Record<string, number[]>> = {
  guitar: GUITAR,
  ukulele: UKULELE,
};

/** Fingering for a chord label on an instrument, or null if we don't have one. */
export function shapeFor(label: string, instrument: Instrument): ChordShape | null {
  const frets = TABLES[instrument]?.[label];
  return frets ? { frets } : null;
}
