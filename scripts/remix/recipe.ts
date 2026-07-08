// scripts/remix/recipe.ts
/**
 * Remix recipe: the small declarative "index card" describing a gig arrangement
 * as an ordered list of passes over the canonical song. Validation is strict and
 * named — the compiler never guesses (spec: Error handling).
 */
import type { SongStructure } from './structure';

export interface RemixPass {
  label?: string;
  /** Sections to play, in order. Absent = all sections as written. */
  sections?: string[];
  /** 'off' = single volta-collapsed pass; counts = per-section pass counts. */
  repeats?: 'off' | 'as-written' | Record<string, number>;
  /** 'off' strips lyric lines; {verse:n} keeps line n in non-chorus sections;
   *  {chorus:true} keeps line 1 in sections labeled "chorus". Inert until
   *  canonicals embed lyrics (sub-project 2). */
  lyrics?: 'off' | { verse?: number; chorus?: boolean };
  /** Append this section once at the end of the pass (volta-collapsed). */
  endWith?: string;
}

export interface RemixRecipe {
  songId: string;
  variantId: string;
  name: string;
  passes: RemixPass[];
}

export class RemixError extends Error {
  constructor(recipeId: string, message: string) {
    super(`[${recipeId}] ${message}`);
    this.name = 'RemixError';
  }
}

const ID = /^[a-z0-9-]+$/;

export function validateRecipe(raw: unknown, structure: SongStructure): RemixRecipe {
  const r = raw as Partial<RemixRecipe>;
  const rid = `${r?.songId ?? '?'}.${r?.variantId ?? '?'}`;
  const fail = (msg: string): never => {
    throw new RemixError(rid, msg);
  };

  if (!r || typeof r !== 'object') fail('recipe must be a JSON object');
  if (typeof r.songId !== 'string' || !ID.test(r.songId)) fail('songId must match /^[a-z0-9-]+$/');
  if (typeof r.variantId !== 'string' || !ID.test(r.variantId)) fail('variantId must match /^[a-z0-9-]+$/');
  if (typeof r.name !== 'string' || r.name.length === 0) fail('name must be a non-empty string');
  if (!Array.isArray(r.passes) || r.passes.length === 0) fail('recipe needs at least one pass');

  const labels = new Set(structure.sections.map((s) => s.label));
  const known = (label: string, where: string) => {
    if (!labels.has(label)) fail(`${where}: unknown section "${label}" (score has: ${[...labels].join(', ')})`);
  };

  r.passes.forEach((p, i) => {
    const where = `pass ${i + 1}`;
    if (typeof p !== 'object' || p === null) fail(`${where}: must be an object`);
    for (const s of p.sections ?? []) known(s, where);
    if (p.endWith !== undefined) known(p.endWith, where);
    if (p.repeats !== undefined && p.repeats !== 'off' && p.repeats !== 'as-written') {
      for (const [label, count] of Object.entries(p.repeats)) {
        known(label, where);
        if (!Number.isInteger(count) || count < 1) fail(`${where}: repeat count for "${label}" must be at least 1`);
      }
    }
    if (p.lyrics !== undefined && p.lyrics !== 'off') {
      if (structure.lyricNumbers.length === 0) {
        fail(`${where}: song has no embedded lyrics — lyric passes need lyrics in the canonical MusicXML (sub-project 2)`);
      }
      if (p.lyrics.verse !== undefined && !structure.lyricNumbers.includes(p.lyrics.verse)) {
        fail(`${where}: verse ${p.lyrics.verse} not in the score (has lyric lines: ${structure.lyricNumbers.join(', ')})`);
      }
    }
  });

  return r as RemixRecipe;
}
