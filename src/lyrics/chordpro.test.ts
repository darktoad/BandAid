import { describe, it, expect } from 'vitest';
import { parseChordPro, lineChunks, transposeSheet } from './chordpro';

describe('transposeSheet', () => {
  it('transposes every chord symbol and leaves lyrics/offsets alone', () => {
    const sheet = parseChordPro('[G]From the [C]great Atlantic shore');
    const up2 = transposeSheet(sheet, 2, false);
    expect(up2.sections[0].lines[0].chords).toEqual([
      { sym: 'A', index: 0 },
      { sym: 'D', index: 9 },
    ]);
    expect(up2.sections[0].lines[0].text).toBe('From the great Atlantic shore');
  });

  it('spells with flats when asked', () => {
    const sheet = parseChordPro('[G]row your [D7]boat');
    const up3 = transposeSheet(sheet, 3, true);
    expect(up3.sections[0].lines[0].chords.map((c) => c.sym)).toEqual(['Bb', 'F7']);
  });

  it('returns the same sheet object for a 0-semitone transpose', () => {
    const sheet = parseChordPro('[G]line');
    expect(transposeSheet(sheet, 0, false)).toBe(sheet);
  });
});

describe('parseChordPro', () => {
  it('extracts chords with their char offset into the stripped text', () => {
    const sheet = parseChordPro('[G]From the [C]great Atlantic shore');
    expect(sheet.sections).toHaveLength(1);
    const line = sheet.sections[0].lines[0];
    expect(line.text).toBe('From the great Atlantic shore');
    expect(line.chords).toEqual([
      { sym: 'G', index: 0 },
      { sym: 'C', index: 9 },
    ]);
  });

  it('handles a chord mid-word and a chord at end of line', () => {
    const line = parseChordPro('Atl[C]antic shore[G]').sections[0].lines[0];
    expect(line.text).toBe('Atlantic shore');
    expect(line.chords).toEqual([
      { sym: 'C', index: 3 },
      { sym: 'G', index: 14 }, // text.length
    ]);
  });

  it('keeps a chord-less line (no chords)', () => {
    const line = parseChordPro('just words, no chords').sections[0].lines[0];
    expect(line.chords).toEqual([]);
    expect(line.text).toBe('just words, no chords');
  });

  it('splits sections, captures labels, and maps kind', () => {
    const sheet = parseChordPro(
      '{start_of_verse: Verse 1}\n[G]line one\n{end_of_verse}\n{start_of_chorus}\n[C]chorus line\n{end_of_chorus}',
    );
    expect(sheet.sections.map((s) => ({ kind: s.kind, label: s.label }))).toEqual([
      { kind: 'verse', label: 'Verse 1' },
      { kind: 'chorus', label: undefined },
    ]);
  });

  it('supports the {sov}/{soc} short forms', () => {
    expect(parseChordPro('{soc}\n[C]hey\n{eoc}').sections[0].kind).toBe('chorus');
    expect(parseChordPro('{sov}\n[G]hey\n{eov}').sections[0].kind).toBe('verse');
  });

  it('puts leading label-less lines into one "other" section', () => {
    const sheet = parseChordPro('[G]loose line\nanother');
    expect(sheet.sections).toHaveLength(1);
    expect(sheet.sections[0].kind).toBe('other');
    expect(sheet.sections[0].lines).toHaveLength(2);
  });

  it('ignores unknown directives and blank lines', () => {
    const sheet = parseChordPro('{title: Whatever}\n\n[G]real line');
    expect(sheet.sections).toHaveLength(1);
    expect(sheet.sections[0].lines).toHaveLength(1);
    expect(sheet.sections[0].lines[0].text).toBe('real line');
  });

  it('returns no sections for empty input', () => {
    expect(parseChordPro('')).toEqual({ sections: [] });
  });

  it('turns {comment} into a standalone cue section between sections', () => {
    const sheet = parseChordPro(
      '{comment: Instrumental playthrough first}\n{start_of_verse: Verse 1}\n[G]line\n{end_of_verse}\n{c: Close on section 2}',
    );
    expect(sheet.sections.map((s) => ({ kind: s.kind, label: s.label }))).toEqual([
      { kind: 'comment', label: 'Instrumental playthrough first' },
      { kind: 'verse', label: 'Verse 1' },
      { kind: 'comment', label: 'Close on section 2' },
    ]);
    expect(sheet.sections[0].lines).toEqual([]);
  });

  it('a comment does not interrupt the current section', () => {
    // Lines after a mid-section comment still belong to that section.
    const sheet = parseChordPro('{sov}\n[G]one\n{c: aside}\n[C]two\n{eov}');
    expect(sheet.sections.map((s) => s.kind)).toEqual(['verse', 'comment']);
    expect(sheet.sections[0].lines.map((l) => l.text)).toEqual(['one', 'two']);
  });

  it('transposeSheet leaves comment cues untouched', () => {
    const sheet = parseChordPro('{comment: watch the ending}\n{sov}\n[G]line\n{eov}');
    const up = transposeSheet(sheet, 2, false);
    expect(up.sections[0]).toEqual({ kind: 'comment', label: 'watch the ending', lines: [] });
  });
});

describe('lineChunks', () => {
  it('anchors each chord to its first word and splits the rest into word chunks', () => {
    const line = parseChordPro('Oh [G]say can [C]you see').sections[0].lines[0];
    expect(lineChunks(line)).toEqual([
      { sym: '', text: 'Oh ' },
      { sym: 'G', text: 'say ' },
      { sym: '', text: 'can ' },
      { sym: 'C', text: 'you ' },
      { sym: '', text: 'see' },
    ]);
  });

  it('a line starting with a chord has no leading empty chunk', () => {
    const line = parseChordPro('[G]hello').sections[0].lines[0];
    expect(lineChunks(line)).toEqual([{ sym: 'G', text: 'hello' }]);
  });

  it('a chord-less line splits into word chunks with no symbols', () => {
    const line = parseChordPro('plain words').sections[0].lines[0];
    expect(lineChunks(line)).toEqual([
      { sym: '', text: 'plain ' },
      { sym: '', text: 'words' },
    ]);
  });

  it('a long run under one chord becomes wrappable word chunks (regression: mobile clipping)', () => {
    const line = parseChordPro('As she [D]glides along the woodlands').sections[0].lines[0];
    const chunks = lineChunks(line);
    expect(chunks).toEqual([
      { sym: '', text: 'As ' },
      { sym: '', text: 'she ' },
      { sym: 'D', text: 'glides ' },
      { sym: '', text: 'along ' },
      { sym: '', text: 'the ' },
      { sym: '', text: 'woodlands' },
    ]);
    // Lossless: chunk texts reassemble the exact original line.
    expect(chunks.map((c) => c.text).join('')).toBe(line.text);
  });

  it('keeps a slot for an end-of-line chord', () => {
    const line = parseChordPro('shore[G]').sections[0].lines[0];
    expect(lineChunks(line)).toEqual([
      { sym: '', text: 'shore' },
      { sym: 'G', text: '' },
    ]);
  });
});
