// scripts/remix/build.ts
/**
 * Build (or verify) all committed remix recipes:
 *   npm run remix:build                      -- write every variant chart
 *   npm run remix:build -- wabash-cannonball.july-gig   -- just one
 *   npm run remix:check                      -- exit 1 on any drift (CI gate)
 * Recipe filename must be <songId>.<variantId>.remix.json and match its content.
 */
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { compileRemix } from './compile';

const SONGS = join('public', 'songs');
const RECIPES = join(SONGS, 'remixes');

const args = process.argv.slice(2);
const check = args.includes('--check');
const only = args.find((a) => a !== '--check');

const recipeFiles = existsSync(RECIPES)
  ? readdirSync(RECIPES).filter((f) => f.endsWith('.remix.json')).sort()
  : [];

let failed = false;
let built = 0;

for (const file of recipeFiles) {
  const id = file.replace(/\.remix\.json$/, ''); // "<songId>.<variantId>"
  if (only && id !== only) continue;

  const raw = JSON.parse(readFileSync(join(RECIPES, file), 'utf8'));
  if (`${raw.songId}.${raw.variantId}` !== id) {
    console.error(`✗ ${file}: filename does not match songId/variantId in the recipe`);
    failed = true;
    continue;
  }
  const canonicalPath = join(SONGS, `${raw.songId}.musicxml`);
  if (!existsSync(canonicalPath)) {
    console.error(`✗ ${file}: canonical ${canonicalPath} not found`);
    failed = true;
    continue;
  }

  let out: string;
  try {
    out = compileRemix(readFileSync(canonicalPath, 'utf8'), raw);
  } catch (e) {
    console.error(`✗ ${file}: ${e instanceof Error ? e.message : e}`);
    failed = true;
    continue;
  }

  const outPath = join(SONGS, `${id}.musicxml`);
  if (check) {
    const committed = existsSync(outPath) ? readFileSync(outPath, 'utf8') : null;
    if (committed !== out) {
      console.error(`✗ ${outPath} is stale or missing — run: npm run remix:build`);
      failed = true;
    } else {
      console.log(`✓ ${outPath} up to date`);
    }
  } else {
    writeFileSync(outPath, out);
    console.log(`built ${outPath}`);
    built++;
  }
}

if (recipeFiles.length === 0) console.log('no recipes found — nothing to do');
else if (!check) console.log(`${built} variant(s) built`);
if (failed) process.exit(1);
