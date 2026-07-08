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
    expect(() => validateRecipe(bad, structure)).toThrow(/at least 1/);
  });
});
