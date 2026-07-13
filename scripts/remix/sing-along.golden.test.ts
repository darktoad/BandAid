// scripts/remix/sing-along.golden.test.ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { compileRemix } from './compile';

/** Drift guard: the committed variant chart must be exactly what its recipe
 *  compiles to from the current canonical. Fails => run `npm run remix:build`
 *  and re-verify the chart (lyrics land under the right chords) by eye. */
describe('wabash-cannonball.sing-along golden', () => {
  it('committed chart matches a fresh compile', () => {
    const recipe = JSON.parse(
      readFileSync('public/songs/remixes/wabash-cannonball.sing-along.remix.json', 'utf8'),
    );
    const canonical = readFileSync('public/songs/wabash-cannonball.musicxml', 'utf8');
    const committed = readFileSync('public/songs/wabash-cannonball.sing-along.musicxml', 'utf8');
    expect(compileRemix(canonical, recipe)).toBe(committed);
  });
});
