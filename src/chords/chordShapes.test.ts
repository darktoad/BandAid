import { describe, it, expect } from 'vitest';
import { shapeFor, type Instrument } from './chordShapes';

// Open-string pitch classes, low-to-high (C = 0 ... B = 11).
const TUNING: Record<Instrument, number[]> = {
  guitar: [4, 9, 2, 7, 11, 4], // E A D G B E
  ukulele: [7, 0, 4, 9], // G C E A
};

const NATURAL_PC: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

function rootPitchClass(root: string): number {
  const natural = NATURAL_PC[root[0]];
  const alter = root.endsWith('#') ? 1 : root.endsWith('b') ? -1 : 0;
  return (natural + alter + 12) % 12;
}

const SHARP_ROOTS = ['C#', 'D#', 'F#', 'G#', 'A#'];
const FLAT_ROOTS = ['Db', 'Eb', 'Gb', 'Ab', 'Bb'];
const NATURAL_ROOTS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const QUALITIES = ['', 'm', '7'];
const INSTRUMENTS: Instrument[] = ['guitar', 'ukulele'];

describe('shapeFor', () => {
  it('returns a 6-string shape for a guitar chord', () => {
    const c = shapeFor('C', 'guitar');
    expect(c?.frets).toHaveLength(6);
  });

  it('returns a 4-string shape for a ukulele chord', () => {
    const c = shapeFor('C', 'ukulele');
    expect(c?.frets).toHaveLength(4);
  });

  it('covers every major chord in the current library on both instruments', () => {
    for (const label of ['C', 'F', 'G', 'A', 'D']) {
      expect(shapeFor(label, 'guitar'), `guitar ${label}`).not.toBeNull();
      expect(shapeFor(label, 'ukulele'), `ukulele ${label}`).not.toBeNull();
    }
  });

  it('covers every accidental root, both spellings, for major/minor/7 on both instruments', () => {
    for (const root of [...SHARP_ROOTS, ...FLAT_ROOTS]) {
      for (const quality of QUALITIES) {
        for (const instrument of INSTRUMENTS) {
          const label = root + quality;
          expect(shapeFor(label, instrument), `${instrument} ${label}`).not.toBeNull();
        }
      }
    }
  });

  it('gives enharmonic spellings the identical fingering', () => {
    const pairs = SHARP_ROOTS.map((sharp, i) => [sharp, FLAT_ROOTS[i]] as const);
    for (const [sharp, flat] of pairs) {
      for (const quality of QUALITIES) {
        for (const instrument of INSTRUMENTS) {
          expect(
            shapeFor(sharp + quality, instrument)?.frets,
            `${instrument} ${sharp + quality} vs ${flat + quality}`,
          ).toEqual(shapeFor(flat + quality, instrument)?.frets);
        }
      }
    }
  });

  it('every major/minor/7 shape sounds the chord it is labeled as', () => {
    for (const root of [...NATURAL_ROOTS, ...SHARP_ROOTS, ...FLAT_ROOTS]) {
      const r = rootPitchClass(root);
      const third = { '': (r + 4) % 12, m: (r + 3) % 12, '7': (r + 4) % 12 };
      for (const quality of QUALITIES) {
        // Allowed tones; a voicing may omit the fifth (e.g. guitar C7) but nothing else.
        const chordTones = new Set([r, third[quality as keyof typeof third], (r + 7) % 12]);
        if (quality === '7') chordTones.add((r + 10) % 12);
        for (const instrument of INSTRUMENTS) {
          const label = root + quality;
          const shape = shapeFor(label, instrument);
          if (!shape) continue; // coverage is asserted separately
          const sounded = new Set(
            shape.frets
              .map((fret, s) => (fret < 0 ? -1 : (TUNING[instrument][s] + fret) % 12))
              .filter((pc) => pc >= 0),
          );
          const name = `${instrument} ${label} [${shape.frets.join(',')}]`;
          for (const pc of sounded) {
            expect(chordTones, `${name} sounds a non-chord tone (pc ${pc})`).toContain(pc);
          }
          expect(sounded, `${name} is missing its root`).toContain(r);
          expect(sounded, `${name} is missing its third`).toContain(
            third[quality as keyof typeof third],
          );
          if (quality === '7') {
            expect(sounded, `${name} is missing its seventh`).toContain((r + 10) % 12);
          }
        }
      }
    }
  });

  it('returns null for an unknown chord (name-only fallback)', () => {
    expect(shapeFor('C#dim7', 'guitar')).toBeNull();
    expect(shapeFor('Zzz', 'ukulele')).toBeNull();
  });
});
