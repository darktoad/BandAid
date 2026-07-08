// scripts/remix/recipe.test.ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadDoc, parseStructure } from './structure';
import { validateRecipe, RemixError } from './recipe';

const here = dirname(fileURLToPath(import.meta.url));
const structure = parseStructure(
  loadDoc(readFileSync(join(here, 'fixtures', 'two-section.musicxml'), 'utf8')),
);

const base = {
  songId: 'two-section',
  variantId: 'test-mix',
  name: 'Test mix',
  passes: [{ label: 'Page 1', repeats: 'off' as const }],
};

describe('validateRecipe', () => {
  it('accepts a minimal valid recipe', () => {
    expect(validateRecipe(base, structure)).toEqual(base);
  });

  it('rejects malformed ids and empty passes with named errors', () => {
    expect(() => validateRecipe({ ...base, variantId: 'July Gig!' }, structure)).toThrow(RemixError);
    expect(() => validateRecipe({ ...base, variantId: 'July Gig!' }, structure)).toThrow(/variantId/);
    expect(() => validateRecipe({ ...base, passes: [] }, structure)).toThrow(/at least one pass/);
    expect(() => validateRecipe({ ...base, name: '' }, structure)).toThrow(/name/);
  });

  it('rejects references to the unlabeled preamble section ""', () => {
    // A score whose first rehearsal mark is not on measure 1 gets an implicit
    // '' section — it plays in the default order but is not referencable.
    const withPreamble = {
      ...structure,
      sections: [
        { label: '', start: 1, end: 1, backwardRepeat: false, endings: [] },
        ...structure.sections.map((s) => ({ ...s, start: s.start + 1, end: s.end + 1 })),
      ],
    };
    const bad = { ...base, passes: [{ sections: [''] }] };
    expect(() => validateRecipe(bad, withPreamble)).toThrow(RemixError);
    expect(() => validateRecipe(bad, withPreamble)).toThrow(/unknown section ""/);
    const badEnd = { ...base, passes: [{ endWith: '' }] };
    expect(() => validateRecipe(badEnd, withPreamble)).toThrow(/unknown section ""/);
  });

  it('rejects references to unknown sections', () => {
    const bad = { ...base, passes: [{ sections: ['bridge'] }] };
    expect(() => validateRecipe(bad, structure)).toThrow(/unknown section "bridge"/);
    const badEnd = { ...base, passes: [{ endWith: 'coda' }] };
    expect(() => validateRecipe(badEnd, structure)).toThrow(/unknown section "coda"/);
    const badCount = { ...base, passes: [{ repeats: { bridge: 3 } }] };
    expect(() => validateRecipe(badCount, structure)).toThrow(/unknown section "bridge"/);
  });

  it('rejects lyric requests the score cannot satisfy', () => {
    const badVerse = { ...base, passes: [{ lyrics: { verse: 9 } }] };
    expect(() => validateRecipe(badVerse, structure)).toThrow(/verse 9/);
    const noLyrics = { ...structure, lyricNumbers: [] };
    const wantsLyrics = { ...base, passes: [{ lyrics: { verse: 1 } }] };
    expect(() => validateRecipe(wantsLyrics, noLyrics)).toThrow(/no embedded lyrics/);
  });

  it('rejects repeat counts less than 1', () => {
    const bad = { ...base, passes: [{ repeats: { verse: 0 } }] };
    expect(() => validateRecipe(bad, structure)).toThrow(/integer >= 1/);
  });

  it('rejects non-integer repeat counts by name', () => {
    const bad = { ...base, passes: [{ repeats: { verse: 2.5 } }] };
    expect(() => validateRecipe(bad, structure)).toThrow(RemixError);
    expect(() => validateRecipe(bad, structure)).toThrow(/integer >= 1/);
  });

  it('rejects malformed repeats shapes with a named error, never a raw TypeError', () => {
    const withNull = { ...base, passes: [{ repeats: null }] };
    expect(() => validateRecipe(withNull, structure)).toThrow(RemixError);
    expect(() => validateRecipe(withNull, structure)).toThrow(/repeats/);
    const withNumber = { ...base, passes: [{ repeats: 3 }] };
    expect(() => validateRecipe(withNumber, structure)).toThrow(RemixError);
    expect(() => validateRecipe(withNumber, structure)).toThrow(/repeats/);
  });

  it('rejects malformed lyrics shapes with a named error, never a raw TypeError', () => {
    const withNull = { ...base, passes: [{ lyrics: null }] };
    expect(() => validateRecipe(withNull, structure)).toThrow(RemixError);
    expect(() => validateRecipe(withNull, structure)).toThrow(/lyrics/);
    const withString = { ...base, passes: [{ lyrics: 'strip' }] };
    expect(() => validateRecipe(withString, structure)).toThrow(RemixError);
    expect(() => validateRecipe(withString, structure)).toThrow(/lyrics/);
    const withNumber = { ...base, passes: [{ lyrics: 42 }] };
    expect(() => validateRecipe(withNumber, structure)).toThrow(RemixError);
    expect(() => validateRecipe(withNumber, structure)).toThrow(/lyrics/);
  });

  it('rejects malformed sections shapes with a named error, never a raw TypeError', () => {
    const withNull = { ...base, passes: [{ sections: null }] };
    expect(() => validateRecipe(withNull, structure)).toThrow(RemixError);
    expect(() => validateRecipe(withNull, structure)).toThrow(/sections/);
    const withString = { ...base, passes: [{ sections: 'verse' }] };
    expect(() => validateRecipe(withString, structure)).toThrow(RemixError);
    expect(() => validateRecipe(withString, structure)).toThrow(/sections/);
    const withNumberElement = { ...base, passes: [{ sections: [7] }] };
    expect(() => validateRecipe(withNumberElement, structure)).toThrow(RemixError);
    expect(() => validateRecipe(withNumberElement, structure)).toThrow(/sections/);
  });
});
