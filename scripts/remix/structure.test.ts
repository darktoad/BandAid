// scripts/remix/structure.test.ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadDoc, parseStructure } from './structure';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = () => readFileSync(join(here, 'fixtures', 'two-section.musicxml'), 'utf8');

describe('parseStructure', () => {
  it('finds sections at rehearsal marks with repeat and volta info', () => {
    const s = parseStructure(loadDoc(fixture()));
    expect(s.measureCount).toBe(6);
    expect(s.sections).toEqual([
      {
        label: 'verse',
        start: 1,
        end: 3,
        backwardRepeat: true,
        endings: [
          { numbers: [1], start: 2, stop: 2 },
          { numbers: [2], start: 3, stop: 3 },
        ],
      },
      { label: 'chorus', start: 4, end: 6, backwardRepeat: true, endings: [] },
    ]);
  });

  it('collects the lyric line numbers present in the score', () => {
    expect(parseStructure(loadDoc(fixture())).lyricNumbers).toEqual([1, 2]);
  });

  it('treats an unmarked score as one section labeled "all"', () => {
    const bare = fixture().replace(/<direction[^]*?<\/direction>\s*/g, '');
    const s = parseStructure(loadDoc(bare));
    expect(s.sections.map((x) => x.label)).toEqual(['all']);
    expect(s.sections[0]).toMatchObject({ start: 1, end: 6 });
  });

  it('rejects multi-part scores', () => {
    const twoParts = fixture()
      .replace('</part-list>', '<score-part id="P2"><part-name>X</part-name></score-part></part-list>')
      .replace('</score-partwise>', '<part id="P2"><measure number="1"><note><rest/><duration>4</duration></note></measure></part></score-partwise>');
    expect(() => parseStructure(loadDoc(twoParts))).toThrow(/multi-part/i);
  });

  it('rejects a volta span that crosses a section boundary', () => {
    // Move ending 2's stop from measure 3 to measure 4, so the volta opened in
    // "verse" would close inside "chorus".
    const crossed = fixture()
      .replace('<barline location="right"><ending number="2" type="stop" /></barline>', '')
      .replace('<measure number="4">', '<measure number="4"><barline location="left"><ending number="2" type="stop" /></barline>');
    expect(() => parseStructure(loadDoc(crossed))).toThrow(/volta.*crosses/i);
  });

  it('rejects a repeat group that crosses a section boundary', () => {
    // Move the chorus rehearsal mark to measure 5, so verse's m4 forward repeat
    // group would close inside "chorus".
    const crossed = fixture()
      .replace(/<direction placement="above">\s*<direction-type><rehearsal>chorus[^]*?<\/direction>\s*/, '')
      .replace('<measure number="5">', '<measure number="5"><direction placement="above"><direction-type><rehearsal>chorus</rehearsal></direction-type></direction>');
    expect(() => parseStructure(loadDoc(crossed))).toThrow(/crosses/i);
  });
});
