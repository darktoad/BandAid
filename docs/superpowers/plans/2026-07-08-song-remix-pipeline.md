# Song Remix Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship "remixes" — named gig arrangements of a song, authored as small recipe JSON files and compiled offline into ordinary MusicXML variant charts the app loads like any song.

**Architecture:** A deterministic Node compiler (`scripts/remix/`) expands `canonical MusicXML + recipe JSON → variant MusicXML`, both committed. The library manifest gains `variants` per song and `variantId` per set-list entry; an "arrangement chip" in the song header switches arrangements session-wide by publishing a **song ref** (`songId@variantId`) through the existing `currentSongId` sync channel. Spec: `docs/superpowers/specs/2026-07-08-song-remix-pipeline-design.md`.

**Tech Stack:** TypeScript everywhere. Compiler: `tsx` + `@xmldom/xmldom` (new devDependency), tested with vitest. App: Svelte 5. CI: new GitHub Actions PR workflow.

## Global Constraints

- Branch: work on `song-remix-pipeline`; land via PR into `main` — never push `main` directly.
- No VERSION, CHANGELOG, or TODOS files — this repo ships unversioned PRs.
- The app never derives notation at runtime: variants are plain MusicXML static assets; all expansion happens in `scripts/remix/`.
- Generated variant charts are committed and must be byte-identical when regenerated (`npm run remix:check` guards this).
- Recipes change *form* only. Key/tempo stay on `SetListEntry.keyOverride`/`tempoOverride` and the in-app settings; lyrics selection is validated but inert until canonicals carry embedded lyrics (sub-project 2).
- Switching arrangements is session-level (same semantics as switching songs), carried as a song ref `<songId>@<variantId>` in the existing `SharedSongIntent.songId` string — no sync schema change.
- ids: `songId` and `variantId` both match `/^[a-z0-9-]+$/` (`@` and `.` stay unambiguous in refs and filenames).
- All commands run from the repo root. Run `npm test` (vitest) and `npm run check` (svelte-check) before each commit that touches `src/`.

## File Structure

| File | Responsibility |
|---|---|
| `src/library/songRef.ts` (new) | Pure song-ref helpers: parse/format `songId@variantId`, variant file path convention |
| `src/library/songRef.test.ts` (new) | Unit tests for the above |
| `src/library/types.ts` (modify) | `SongVariant`, `SongSummary.variants`, `SetListEntry.variantId` |
| `src/library/libraryService.ts` (modify) | `getVariant`, `getSetListItems` (entry-aware set-list resolution) |
| `src/library/libraryService.test.ts` (modify) | Tests for new service methods |
| `src/library/manifest.test.ts` (modify) | Manifest integrity: unique variant ids, set-list variantIds resolve |
| `scripts/remix/structure.ts` (new) | MusicXML → `SongStructure` (sections from rehearsal marks, repeats, voltas, lyric numbers) |
| `scripts/remix/recipe.ts` (new) | Recipe types + validation against a `SongStructure`; `RemixError` |
| `scripts/remix/compile.ts` (new) | `compileRemix(xml, recipe) → variant xml` — expansion + serialization |
| `scripts/remix/build.ts` (new) | CLI: build all/one recipe; `--check` mode for drift |
| `scripts/remix/fixtures/two-section.musicxml` (new) | Small fixture: 2 labeled sections, voltas, plain repeat, 2 lyric lines |
| `scripts/remix/*.test.ts` (new) | Compiler unit tests + Wabash golden test |
| `public/songs/wabash-cannonball.musicxml` (modify) | Add rehearsal-mark section labels (one-time structure audit) |
| `public/songs/remixes/wabash-cannonball.july-gig.remix.json` (new) | First real recipe (instrumental passes only until sub-project 2) |
| `public/songs/wabash-cannonball.july-gig.musicxml` (generated, committed) | First compiled variant chart |
| `public/library.json` (modify) | Wabash `variants` entry + a set-list entry using it |
| `src/App.svelte` (modify) | Variant-aware open/show/boot/follow/URL/lastSong via song refs; chip callback |
| `src/views/BrowseView.svelte` (modify) | Set-list rows resolve entries (variant-aware), show variant name |
| `src/views/ChordChangesView.svelte` (modify) | Arrangement chip in the top header |
| `package.json` (modify) | `remix:build`, `remix:check` scripts; `@xmldom/xmldom` devDependency |
| `.github/workflows/ci.yml` (new) | PR checks: test, svelte-check, remix drift |
| `README.md` (modify) | Short "Remixes (arrangements)" section |

---

### Task 1: Song ref helpers

**Files:**
- Create: `src/library/songRef.ts`
- Test: `src/library/songRef.test.ts`

**Interfaces:**
- Consumes: nothing (pure strings).
- Produces (used by Tasks 7–9):
  - `interface SongRef { songId: string; variantId?: string }`
  - `formatSongRef(songId: string, variantId?: string | null): string`
  - `parseSongRef(ref: string): SongRef`
  - `songFilePath(songId: string, variantId?: string | null): string` → `"songs/<songId>.musicxml"` or `"songs/<songId>.<variantId>.musicxml"`

- [ ] **Step 1: Write the failing test**

```ts
// src/library/songRef.test.ts
import { describe, it, expect } from 'vitest';
import { formatSongRef, parseSongRef, songFilePath } from './songRef';

describe('songRef', () => {
  it('formats a canonical ref as the bare song id', () => {
    expect(formatSongRef('wabash-cannonball')).toBe('wabash-cannonball');
    expect(formatSongRef('wabash-cannonball', null)).toBe('wabash-cannonball');
  });

  it('formats a variant ref as songId@variantId', () => {
    expect(formatSongRef('wabash-cannonball', 'july-gig')).toBe('wabash-cannonball@july-gig');
  });

  it('parses a bare id and a variant ref', () => {
    expect(parseSongRef('wabash-cannonball')).toEqual({ songId: 'wabash-cannonball' });
    expect(parseSongRef('wabash-cannonball@july-gig')).toEqual({
      songId: 'wabash-cannonball',
      variantId: 'july-gig',
    });
  });

  it('round-trips', () => {
    const ref = formatSongRef('old-blue', 'slow-jam');
    expect(formatSongRef(parseSongRef(ref).songId, parseSongRef(ref).variantId)).toBe(ref);
  });

  it('treats an empty variant segment as canonical', () => {
    expect(parseSongRef('old-blue@')).toEqual({ songId: 'old-blue' });
  });

  it('builds file paths by convention', () => {
    expect(songFilePath('old-blue')).toBe('songs/old-blue.musicxml');
    expect(songFilePath('wabash-cannonball', 'july-gig')).toBe(
      'songs/wabash-cannonball.july-gig.musicxml',
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/library/songRef.test.ts`
Expected: FAIL — `Cannot find module './songRef'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/library/songRef.ts
/**
 * Song ref: the string identity of "what's loaded" — a canonical song
 * (`old-blue`) or a named arrangement (`wabash-cannonball@july-gig`). Refs travel
 * everywhere a song id string already travels (session doc, ?song= URL, last-song
 * localStorage) so arrangement switches sync exactly like song switches. Both id
 * segments are /^[a-z0-9-]+$/, so '@' and '.' stay unambiguous.
 */

export interface SongRef {
  songId: string;
  variantId?: string;
}

const SEP = '@';

export function formatSongRef(songId: string, variantId?: string | null): string {
  return variantId ? `${songId}${SEP}${variantId}` : songId;
}

export function parseSongRef(ref: string): SongRef {
  const i = ref.indexOf(SEP);
  if (i < 0) return { songId: ref };
  const variantId = ref.slice(i + 1);
  return variantId ? { songId: ref.slice(0, i), variantId } : { songId: ref.slice(0, i) };
}

/** File convention: canonical `songs/<id>.musicxml`; variant `songs/<id>.<variantId>.musicxml`. */
export function songFilePath(songId: string, variantId?: string | null): string {
  return variantId ? `songs/${songId}.${variantId}.musicxml` : `songs/${songId}.musicxml`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/library/songRef.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/library/songRef.ts src/library/songRef.test.ts
git commit -m "feat(library): song ref helpers — songId@variantId identity + file convention"
```

---

### Task 2: Library types + variant-aware service

**Files:**
- Modify: `src/library/types.ts`
- Modify: `src/library/libraryService.ts`
- Modify: `src/library/libraryService.test.ts`
- Modify: `src/library/manifest.test.ts`

**Interfaces:**
- Consumes: existing `LibraryManifest`, `SongSummary`, `SetList`.
- Produces (used by Tasks 7–9):
  - `interface SongVariant { id: string; name: string; notes?: string }`
  - `SongSummary.variants?: SongVariant[]`
  - `SetListEntry.variantId?: string`
  - `LibraryService.getVariant(songId: string, variantId: string): SongVariant | null`
  - `LibraryService.getSetListItems(setListId: string): Array<{ song: SongSummary; variantId?: string; variantName?: string }>`

- [ ] **Step 1: Add the types**

In `src/library/types.ts`, add above `SongSummary`:

```ts
/** A named arrangement of a song, compiled offline from a remix recipe
 *  (scripts/remix). The chart file is songs/<songId>.<variantId>.musicxml. */
export interface SongVariant {
  id: string; // /^[a-z0-9-]+$/, unique within the song
  name: string; // shown in the arrangement chip, e.g. "July gig 4-pager"
  notes?: string;
}
```

Add to `SongSummary` (after `parts`):

```ts
  /** Named arrangements (remixes). Absent/empty = canonical only. */
  variants?: SongVariant[];
```

Add to `SetListEntry` (after `songId`):

```ts
  /** Open this arrangement when picked from the set list. Absent = canonical. */
  variantId?: string;
```

- [ ] **Step 2: Write the failing service tests**

Append to `src/library/libraryService.test.ts` (it already builds services over in-memory manifests — follow its local helper style for constructing a manifest; the shape below is self-contained):

```ts
describe('variants', () => {
  const song = (id: string, extra: Partial<SongSummary> = {}): SongSummary => ({
    id,
    title: id,
    defaultKey: { fifths: 0, mode: 'major', tonalCenter: 'C' },
    defaultTempoBpm: 100,
    timeSignature: '4/4',
    content: { hasMelody: true, hasChords: true, hasTab: false },
    parts: [],
    ...extra,
  });

  const manifest: LibraryManifest = {
    songs: [
      song('wabash', { variants: [{ id: 'july-gig', name: 'July gig' }] }),
      song('old-blue'),
    ],
    setLists: [
      {
        id: 'gig',
        name: 'Gig',
        entries: [
          { songId: 'wabash' },
          { songId: 'wabash', variantId: 'july-gig' },
          { songId: 'wabash', variantId: 'nope' },
          { songId: 'missing-song' },
          { songId: 'old-blue' },
        ],
      },
    ],
  };
  const svc = makeLibraryService(manifest);

  it('getVariant resolves declared variants and returns null otherwise', () => {
    expect(svc.getVariant('wabash', 'july-gig')).toEqual({ id: 'july-gig', name: 'July gig' });
    expect(svc.getVariant('wabash', 'nope')).toBeNull();
    expect(svc.getVariant('old-blue', 'july-gig')).toBeNull();
    expect(svc.getVariant('missing-song', 'july-gig')).toBeNull();
  });

  it('getSetListItems resolves entries with variant info, dropping unknown songs and unknown variants', () => {
    const items = svc.getSetListItems('gig');
    expect(items.map((i) => [i.song.id, i.variantId ?? null])).toEqual([
      ['wabash', null],
      ['wabash', 'july-gig'],
      ['wabash', null], // unknown variantId falls back to canonical
      ['old-blue', null],
    ]);
    expect(items[1].variantName).toBe('July gig');
  });

  it('getSetListItems returns [] for an unknown set list', () => {
    expect(svc.getSetListItems('nope')).toEqual([]);
  });
});
```

Add `LibraryManifest` and `SongSummary` to the test file's type imports if not already present.

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run src/library/libraryService.test.ts`
Expected: FAIL — `svc.getVariant is not a function`.

- [ ] **Step 4: Implement the service methods**

In `src/library/libraryService.ts`:

Add to the `LibraryService` interface:

```ts
  /** A song's declared arrangement, or null (unknown song or variant). */
  getVariant(songId: string, variantId: string): SongVariant | null;
  /** Set-list entries resolved to songs + arrangement info, in order. Unknown song
   *  ids are dropped (as before); unknown variant ids fall back to canonical. */
  getSetListItems(setListId: string): Array<{ song: SongSummary; variantId?: string; variantName?: string }>;
```

Add `SongVariant` to the type imports from `./types` (and re-export it at the bottom alongside the existing re-exports).

Add to the returned object in `makeLibraryService`:

```ts
    getVariant(songId: string, variantId: string) {
      return byId.get(songId)?.variants?.find((v) => v.id === variantId) ?? null;
    },
    getSetListItems(setListId: string) {
      const list = manifest.setLists.find((l) => l.id === setListId);
      if (!list) return [];
      return list.entries.flatMap((e) => {
        const song = byId.get(e.songId);
        if (!song) return [];
        const variant = e.variantId ? song.variants?.find((v) => v.id === e.variantId) : undefined;
        return [{ song, variantId: variant?.id, variantName: variant?.name }];
      });
    },
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/library/libraryService.test.ts`
Expected: PASS.

- [ ] **Step 6: Extend the manifest integrity test**

Append to `src/library/manifest.test.ts` inside the existing `describe`:

```ts
  it('variant ids are well-formed and unique per song', () => {
    for (const s of m.songs) {
      const ids = (s.variants ?? []).map((v) => v.id);
      for (const id of ids) expect(id, `${s.id} variant id`).toMatch(/^[a-z0-9-]+$/);
      expect(new Set(ids).size, `${s.id} variant ids unique`).toBe(ids.length);
    }
  });

  it('set-list variant references resolve to declared variants', () => {
    const byId = new Map(m.songs.map((s) => [s.id, s]));
    for (const list of m.setLists) {
      for (const e of list.entries) {
        if (!e.variantId) continue;
        const song = byId.get(e.songId);
        expect(song, `${list.id}: ${e.songId}`).toBeDefined();
        expect(
          song!.variants?.some((v) => v.id === e.variantId),
          `${list.id}: ${e.songId}@${e.variantId}`,
        ).toBe(true);
      }
    }
  });
```

- [ ] **Step 7: Run the full suite and typecheck**

Run: `npm test && npm run check`
Expected: PASS (manifest currently has no variants, so the new checks pass vacuously).

- [ ] **Step 8: Commit**

```bash
git add src/library/types.ts src/library/libraryService.ts src/library/libraryService.test.ts src/library/manifest.test.ts
git commit -m "feat(library): SongVariant type, variant-aware service + manifest integrity checks"
```

---

### Task 3: Compiler — structure parser + fixture

**Files:**
- Create: `scripts/remix/fixtures/two-section.musicxml`
- Create: `scripts/remix/structure.ts`
- Test: `scripts/remix/structure.test.ts`
- Modify: `package.json` (devDependency)

**Interfaces:**
- Consumes: nothing.
- Produces (used by Tasks 4–5):
  - `interface EndingSpan { numbers: number[]; start: number; stop: number }` (1-based measure indexes, inclusive)
  - `interface Section { label: string; start: number; end: number; backwardRepeat: boolean; endings: EndingSpan[] }`
  - `interface SongStructure { measureCount: number; sections: Section[]; lyricNumbers: number[] }`
  - `parseStructure(doc: Document): SongStructure` — throws `Error` on multi-part scores or repeats crossing section boundaries
  - `loadDoc(xml: string): Document` / `serializeDoc(doc: Document): string` (xmldom wrappers)

- [ ] **Step 1: Install the XML dependency**

Run: `npm install -D @xmldom/xmldom`
Expected: added to `devDependencies` in `package.json`.

- [ ] **Step 2: Create the fixture**

`scripts/remix/fixtures/two-section.musicxml` — two labeled sections: `verse` (m1–m3, forward repeat, voltas 1/2, lyric lines 1–2) and `chorus` (m4–m6, plain forward/backward repeat, lyric line 1):

```xml
<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list>
    <score-part id="P1"><part-name>Voice</part-name></score-part>
  </part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>1</divisions>
        <key><fifths>0</fifths></key>
        <time><beats>4</beats><beat-type>4</beat-type></time>
        <clef><sign>G</sign><line>2</line></clef>
      </attributes>
      <direction placement="above">
        <direction-type><rehearsal>verse</rehearsal></direction-type>
      </direction>
      <barline location="left"><repeat direction="forward" /></barline>
      <note>
        <pitch><step>C</step><octave>4</octave></pitch>
        <duration>4</duration><type>whole</type>
        <lyric number="1"><syllabic>single</syllabic><text>one</text></lyric>
        <lyric number="2"><syllabic>single</syllabic><text>two</text></lyric>
      </note>
    </measure>
    <measure number="2">
      <barline location="left"><ending number="1" type="start" /></barline>
      <note>
        <pitch><step>D</step><octave>4</octave></pitch>
        <duration>4</duration><type>whole</type>
        <lyric number="1"><syllabic>single</syllabic><text>uno</text></lyric>
        <lyric number="2"><syllabic>single</syllabic><text>dos</text></lyric>
      </note>
      <barline location="right">
        <ending number="1" type="stop" />
        <repeat direction="backward" />
      </barline>
    </measure>
    <measure number="3">
      <barline location="left"><ending number="2" type="start" /></barline>
      <note>
        <pitch><step>E</step><octave>4</octave></pitch>
        <duration>4</duration><type>whole</type>
      </note>
      <barline location="right"><ending number="2" type="stop" /></barline>
    </measure>
    <measure number="4">
      <direction placement="above">
        <direction-type><rehearsal>chorus</rehearsal></direction-type>
      </direction>
      <barline location="left"><repeat direction="forward" /></barline>
      <note>
        <pitch><step>F</step><octave>4</octave></pitch>
        <duration>4</duration><type>whole</type>
        <lyric number="1"><syllabic>single</syllabic><text>la</text></lyric>
      </note>
    </measure>
    <measure number="5">
      <note>
        <pitch><step>G</step><octave>4</octave></pitch>
        <duration>4</duration><type>whole</type>
      </note>
    </measure>
    <measure number="6">
      <note>
        <pitch><step>A</step><octave>4</octave></pitch>
        <duration>4</duration><type>whole</type>
      </note>
      <barline location="right"><repeat direction="backward" /></barline>
    </measure>
  </part>
</score-partwise>
```

- [ ] **Step 3: Write the failing structure tests**

```ts
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

  it('rejects a repeat group that crosses a section boundary', () => {
    // Move the chorus rehearsal mark to measure 5, so verse's m4 forward repeat
    // group would close inside "chorus".
    const crossed = fixture()
      .replace(/<direction placement="above">\s*<direction-type><rehearsal>chorus[^]*?<\/direction>\s*/, '')
      .replace('<measure number="5">', '<measure number="5"><direction placement="above"><direction-type><rehearsal>chorus</rehearsal></direction-type></direction>');
    expect(() => parseStructure(loadDoc(crossed))).toThrow(/crosses/i);
  });
});
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `npx vitest run scripts/remix/structure.test.ts`
Expected: FAIL — `Cannot find module './structure'`.

- [ ] **Step 5: Implement the parser**

```ts
// scripts/remix/structure.ts
/**
 * Read the form-level structure out of a canonical MusicXML file: sections
 * (spans between <rehearsal> marks), repeat barlines, volta endings, and which
 * lyric lines exist. This is the "what can a recipe reference" surface; the
 * compiler validates recipes against it and expands passes from it.
 *
 * Conventions this enforces (hard errors, never guesses):
 * - Single-part scores only (canonical band charts are one part today).
 * - Section labels are <rehearsal> marks; measures before the first mark belong
 *   to an implicit section only when there are NO marks at all (label "all").
 * - A repeat/volta group must sit entirely inside one section — label sections
 *   at repeat-group boundaries.
 */
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';

export interface EndingSpan {
  numbers: number[];
  start: number; // 1-based measure index, inclusive
  stop: number;
}

export interface Section {
  label: string;
  start: number;
  end: number;
  backwardRepeat: boolean;
  endings: EndingSpan[];
}

export interface SongStructure {
  measureCount: number;
  sections: Section[];
  lyricNumbers: number[];
}

export function loadDoc(xml: string): Document {
  return new DOMParser().parseFromString(xml, 'text/xml') as unknown as Document;
}

export function serializeDoc(doc: Document): string {
  return new XMLSerializer().serializeToString(doc as never);
}

const els = (parent: Element | Document, tag: string): Element[] =>
  Array.from(parent.getElementsByTagName(tag)) as Element[];

/** The <measure> elements of the single <part>, in document order. */
export function partMeasures(doc: Document): Element[] {
  const parts = els(doc, 'part').filter((p) => p.getElementsByTagName('measure').length > 0);
  if (parts.length !== 1) {
    throw new Error(`remix compiler supports single-part scores only (found ${parts.length} parts)`);
  }
  return Array.from(parts[0].childNodes).filter(
    (n): n is Element => n.nodeType === 1 && n.nodeName === 'measure',
  );
}

export function parseStructure(doc: Document): SongStructure {
  const measures = partMeasures(doc);

  // Section starts: measures carrying a <rehearsal> mark.
  const starts: Array<{ label: string; index: number }> = [];
  measures.forEach((m, i) => {
    const marks = els(m, 'rehearsal');
    if (marks.length > 0) starts.push({ label: marks[0].textContent?.trim() ?? '', index: i + 1 });
  });

  const bounds =
    starts.length === 0
      ? [{ label: 'all', index: 1 }]
      : starts[0].index === 1
        ? starts
        : [{ label: '', index: 1 }, ...starts]; // unlabeled preamble: unreferencable

  const sections: Section[] = bounds.map((b, i) => {
    const start = b.index;
    const end = (bounds[i + 1]?.index ?? measures.length + 1) - 1;

    let backwardRepeat = false;
    const open: Partial<Record<string, { numbers: number[]; start: number }>> = {};
    const endings: EndingSpan[] = [];
    for (let mi = start; mi <= end; mi++) {
      const m = measures[mi - 1];
      for (const r of els(m, 'repeat')) {
        if (r.getAttribute('direction') === 'backward') backwardRepeat = true;
      }
      for (const e of els(m, 'ending')) {
        const numbers = (e.getAttribute('number') ?? '')
          .split(',')
          .map((s) => parseInt(s.trim(), 10))
          .filter((n) => Number.isFinite(n));
        const key = numbers.join(',');
        const type = e.getAttribute('type');
        if (type === 'start') open[key] = { numbers, start: mi };
        else if (type === 'stop' || type === 'discontinue') {
          const o = open[key];
          if (o) {
            endings.push({ numbers: o.numbers, start: o.start, stop: mi });
            delete open[key];
          }
        }
      }
    }
    return { label: b.label, start, end, backwardRepeat, endings };
  });

  // Repeat groups must not cross section boundaries: a forward repeat inside a
  // section requires its backward repeat in the same section.
  for (const sec of sections) {
    let openForward = 0;
    for (let mi = sec.start; mi <= sec.end; mi++) {
      for (const r of els(measures[mi - 1], 'repeat')) {
        if (r.getAttribute('direction') === 'forward') openForward++;
        if (r.getAttribute('direction') === 'backward' && openForward > 0) openForward--;
      }
    }
    if (openForward > 0) {
      throw new Error(
        `repeat group starting in section "${sec.label}" crosses its boundary — add the rehearsal mark at the repeat-group boundary`,
      );
    }
  }

  const lyricNumbers = [
    ...new Set(els(doc, 'lyric').map((l) => parseInt(l.getAttribute('number') ?? '1', 10))),
  ].sort((a, b) => a - b);

  return { measureCount: measures.length, sections, lyricNumbers };
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run scripts/remix/structure.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 7: Commit**

```bash
git add scripts/remix package.json package-lock.json
git commit -m "feat(remix): MusicXML structure parser — sections, repeats, voltas, lyric lines"
```

---

### Task 4: Compiler — recipe types + validation

**Files:**
- Create: `scripts/remix/recipe.ts`
- Test: `scripts/remix/recipe.test.ts`

**Interfaces:**
- Consumes: `SongStructure` from Task 3.
- Produces (used by Tasks 5–6):
  - `interface RemixPass { label?: string; sections?: string[]; repeats?: 'off' | 'as-written' | Record<string, number>; lyrics?: 'off' | { verse?: number; chorus?: boolean }; endWith?: string }`
  - `interface RemixRecipe { songId: string; variantId: string; name: string; passes: RemixPass[] }`
  - `class RemixError extends Error` — message prefixed `[songId.variantId]`
  - `validateRecipe(raw: unknown, structure: SongStructure): RemixRecipe` — returns the typed recipe or throws `RemixError`

- [ ] **Step 1: Write the failing validation tests**

```ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run scripts/remix/recipe.test.ts`
Expected: FAIL — `Cannot find module './recipe'`.

- [ ] **Step 3: Implement validation**

```ts
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run scripts/remix/recipe.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add scripts/remix/recipe.ts scripts/remix/recipe.test.ts
git commit -m "feat(remix): recipe types + strict named validation"
```

---

### Task 5: Compiler — expansion

**Files:**
- Create: `scripts/remix/compile.ts`
- Test: `scripts/remix/compile.test.ts`

**Interfaces:**
- Consumes: Task 3 (`loadDoc`, `serializeDoc`, `partMeasures`, `parseStructure`, `Section`, `EndingSpan`) and Task 4 (`validateRecipe`, `RemixRecipe`, `RemixPass`).
- Produces (used by Task 6): `compileRemix(canonicalXml: string, rawRecipe: unknown): string` — full variant MusicXML text, deterministic; throws `RemixError`/`Error` on invalid input.

**Expansion semantics (normative):**
1. Pass section order = `pass.sections` ?? all sections in score order (sections labeled `''` — an unlabeled preamble — are included in the default order but not referencable).
2. Each section is emitted as `k` iterations:
   - `repeats: 'off'` → `k = 1`, volta-collapsed: include measures not inside any ending span, plus measures of the **highest-numbered** span.
   - `'as-written'` (default) → `k = max ending number`, or `2` if the section has a backward repeat but no voltas, else `1`. Iteration `i` includes measures not in any span, plus measures of the span whose `numbers` contain `i` (if none does, the highest span).
   - `{ section: n }` counts → that section's `k = n` (others: as-written), same per-iteration volta rule.
3. `endWith` appends one volta-collapsed iteration of the named section after the pass body.
4. Lyric filtering per emitted measure clone: `lyrics: 'off'` (or `lyrics` absent) strips all `<lyric>` elements. `{verse: n, chorus: c}`: in sections labeled exactly `chorus` (case-insensitive), keep `<lyric number="1">` if `c` is true, else strip; in all other sections keep only `<lyric number="n">` (renumbered to `"1"`) if `n` given, else strip.
5. Every emitted measure clone: remove `<repeat>` and `<ending>` elements (and any `<barline>` left with no element children); the first measure of each pass gets `<print new-page="yes"/>` prepended (passes 2+ only) and, when `pass.label` is set, a `<direction placement="above"><direction-type><words font-weight="bold">LABEL</words></direction-type></direction>` prepended after any leading `<attributes>`... (prepend both as first children, print first — alphaTab tolerates direction-before-attributes; keep it simple and deterministic).
6. Renumber all emitted measures `1..N` (the `number` attribute). Append `<barline location="right"><bar-style>light-heavy</bar-style></barline>` to the final measure.
7. Output = XML declaration + generated-file comment + serialized document. The comment: `<!-- GENERATED by scripts/remix from remixes/<songId>.<variantId>.remix.json - do not hand-edit -->`.
8. Attributes handling: the clone of a section's first measure keeps whatever `<attributes>` it has; the very first emitted measure must carry the score's initial `<attributes>` — since pass order always starts at some section of the same single part and clones include each measure's own children, the score-level `<attributes>` lives in measure 1. **If the first emitted measure is not the score's measure 1, deep-copy measure 1's `<attributes>` element as its first child** (unless that measure already has one).

- [ ] **Step 1: Write the failing compile tests**

```ts
// scripts/remix/compile.test.ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileRemix } from './compile';
import { loadDoc, partMeasures } from './structure';

const here = dirname(fileURLToPath(import.meta.url));
const xml = readFileSync(join(here, 'fixtures', 'two-section.musicxml'), 'utf8');

const recipe = (passes: unknown[]) => ({
  songId: 'two-section',
  variantId: 'test-mix',
  name: 'Test mix',
  passes,
});

/** Pitch letters of the compiled output, in order — the form fingerprint. */
const steps = (out: string) =>
  partMeasures(loadDoc(out)).map((m) => m.getElementsByTagName('step')[0]?.textContent ?? '·');

describe('compileRemix', () => {
  it('repeats off: one volta-collapsed pass (skips ending 1, keeps ending 2)', () => {
    const out = compileRemix(xml, recipe([{ repeats: 'off' }]));
    // verse: C then volta-2 E (D is volta 1); chorus once: F G A
    expect(steps(out)).toEqual(['C', 'E', 'F', 'G', 'A']);
  });

  it('as-written: voltas unroll and plain repeats double', () => {
    const out = compileRemix(xml, recipe([{ repeats: 'as-written' }]));
    // verse: C D (volta 1) C E (volta 2); chorus twice: F G A F G A
    expect(steps(out)).toEqual(['C', 'D', 'C', 'E', 'F', 'G', 'A', 'F', 'G', 'A']);
  });

  it('per-section counts and explicit section order', () => {
    const out = compileRemix(xml, recipe([{ sections: ['chorus'], repeats: { chorus: 3 } }]));
    expect(steps(out)).toEqual(['F', 'G', 'A', 'F', 'G', 'A', 'F', 'G', 'A']);
  });

  it('endWith appends a volta-collapsed section', () => {
    const out = compileRemix(xml, recipe([{ repeats: 'off', endWith: 'verse' }]));
    expect(steps(out)).toEqual(['C', 'E', 'F', 'G', 'A', 'C', 'E']);
  });

  it('multiple passes stitch with page breaks and labels; measures renumber 1..N', () => {
    const out = compileRemix(
      xml,
      recipe([
        { label: 'Page 1', repeats: 'off' },
        { label: 'Page 2', repeats: 'off' },
      ]),
    );
    const measures = partMeasures(loadDoc(out));
    expect(measures.map((m) => m.getAttribute('number'))).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9', '10']);
    // Page break lands on the first measure of pass 2 (index 5), not pass 1.
    const withNewPage = measures
      .map((m, i) => [i, m.getElementsByTagName('print')] as const)
      .filter(([, p]) => Array.from(p).some((pr) => pr.getAttribute('new-page') === 'yes'))
      .map(([i]) => i);
    expect(withNewPage).toEqual([5]);
    expect(out).toContain('>Page 1<');
    expect(out).toContain('>Page 2<');
    // No repeats or endings survive in the flattened chart.
    expect(out).not.toContain('<repeat');
    expect(out).not.toContain('<ending');
    // Final barline closes the chart.
    const last = measures[measures.length - 1];
    expect(last.getElementsByTagName('bar-style')[0]?.textContent).toBe('light-heavy');
  });

  it('lyric selection: verse pick renumbers to line 1; chorus flag gates chorus lyrics', () => {
    const out = compileRemix(xml, recipe([{ repeats: 'off', lyrics: { verse: 2, chorus: true } }]));
    const doc = loadDoc(out);
    const lyrics = Array.from(doc.getElementsByTagName('lyric'));
    // verse measures keep only former line 2 ("two"), renumbered to 1; chorus keeps "la".
    expect(lyrics.map((l) => [l.getAttribute('number'), l.getElementsByTagName('text')[0]?.textContent])).toEqual([
      ['1', 'two'],
      ['1', 'la'],
    ]);
    const off = compileRemix(xml, recipe([{ repeats: 'off', lyrics: 'off' }]));
    expect(off).not.toContain('<lyric');
  });

  it('is deterministic: identical output across runs', () => {
    const r = recipe([{ repeats: 'off', endWith: 'verse' }]);
    expect(compileRemix(xml, r)).toBe(compileRemix(xml, r));
  });

  it('carries a generated-file comment naming the recipe', () => {
    const out = compileRemix(xml, recipe([{ repeats: 'off' }]));
    expect(out).toContain('GENERATED by scripts/remix from remixes/two-section.test-mix.remix.json');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run scripts/remix/compile.test.ts`
Expected: FAIL — `Cannot find module './compile'`.

- [ ] **Step 3: Implement the compiler**

```ts
// scripts/remix/compile.ts
/**
 * canonical MusicXML + recipe → variant MusicXML ("the machine"). Deterministic:
 * same inputs, byte-identical output. See the plan/spec for the normative
 * expansion semantics; every rule here traces to one of those bullets.
 */
import { loadDoc, serializeDoc, parseStructure, partMeasures, type Section } from './structure';
import { validateRecipe, type RemixPass } from './recipe';

const els = (parent: Element, tag: string): Element[] =>
  Array.from(parent.getElementsByTagName(tag)) as Element[];

/** Measure indexes (1-based) for one iteration of a section. */
function iterationMeasures(sec: Section, iteration: number, collapse: boolean): number[] {
  const highest = sec.endings.reduce((a, e) => Math.max(a, ...e.numbers), 0);
  const wanted = collapse ? highest : iteration;
  const out: number[] = [];
  for (let mi = sec.start; mi <= sec.end; mi++) {
    const span = sec.endings.find((e) => mi >= e.start && mi <= e.stop);
    if (!span) out.push(mi);
    else if (span.numbers.includes(wanted) || (!sec.endings.some((e) => e.numbers.includes(wanted)) && span.numbers.includes(highest))) {
      out.push(mi);
    }
  }
  return out;
}

function sectionIterations(sec: Section, repeats: RemixPass['repeats']): number {
  if (repeats === 'off') return 1;
  const counts = repeats !== undefined && repeats !== 'as-written' ? repeats : undefined;
  const n = counts?.[sec.label];
  if (n !== undefined) return n;
  const maxEnding = sec.endings.reduce((a, e) => Math.max(a, ...e.numbers), 0);
  if (maxEnding > 0) return maxEnding;
  return sec.backwardRepeat ? 2 : 1;
}

function filterLyrics(measure: Element, sec: Section, lyrics: RemixPass['lyrics']): void {
  const isChorus = sec.label.toLowerCase() === 'chorus';
  for (const l of els(measure, 'lyric')) {
    const num = parseInt(l.getAttribute('number') ?? '1', 10);
    let keep = false;
    if (lyrics !== undefined && lyrics !== 'off') {
      if (isChorus) keep = lyrics.chorus === true && num === 1;
      else if (lyrics.verse !== undefined) keep = num === lyrics.verse;
    }
    if (keep) l.setAttribute('number', '1');
    else l.parentNode?.removeChild(l);
  }
}

function stripRepeatMarks(measure: Element): void {
  for (const tag of ['repeat', 'ending']) {
    for (const e of els(measure, tag)) e.parentNode?.removeChild(e);
  }
  for (const b of els(measure, 'barline')) {
    const hasChild = Array.from(b.childNodes).some((n) => n.nodeType === 1);
    if (!hasChild) b.parentNode?.removeChild(b);
  }
}

export function compileRemix(canonicalXml: string, rawRecipe: unknown): string {
  const doc = loadDoc(canonicalXml);
  const structure = parseStructure(doc);
  const recipe = validateRecipe(rawRecipe, structure);
  const measures = partMeasures(doc);
  const part = measures[0].parentNode as Element;
  const byLabel = new Map(structure.sections.map((s) => [s.label, s]));

  // Plan every emitted measure first: [sourceIndex, section, passIndex, isPassStart].
  const emitted: Array<{ src: number; sec: Section; pass: number; passStart: boolean; label?: string }> = [];
  recipe.passes.forEach((pass, pi) => {
    const order = (pass.sections ?? structure.sections.map((s) => s.label)).map((l) => byLabel.get(l)!);
    const seq: Array<{ src: number; sec: Section }> = [];
    for (const sec of order) {
      const k = sectionIterations(sec, pass.repeats);
      const collapse = pass.repeats === 'off';
      for (let i = 1; i <= k; i++) {
        for (const src of iterationMeasures(sec, i, collapse)) seq.push({ src, sec });
      }
    }
    if (pass.endWith !== undefined) {
      const sec = byLabel.get(pass.endWith)!;
      for (const src of iterationMeasures(sec, 1, true)) seq.push({ src, sec });
    }
    seq.forEach((s, i) => emitted.push({ ...s, pass: pi, passStart: i === 0, label: pass.label }));
  });
  if (emitted.length === 0) throw new Error(`[${recipe.songId}.${recipe.variantId}] recipe emits no measures`);

  // Build the flattened part.
  const initialAttributes = els(measures[0], 'attributes')[0] ?? null;
  const clones = emitted.map((e, i) => {
    const m = measures[e.src - 1].cloneNode(true) as Element;
    stripRepeatMarks(m);
    filterLyrics(m, e.sec, recipe.passes[e.pass].lyrics);
    if (i === 0 && e.src !== 1 && initialAttributes && els(m, 'attributes').length === 0) {
      m.insertBefore(initialAttributes.cloneNode(true), m.firstChild);
    }
    if (e.passStart) {
      if (e.label !== undefined) {
        const d = doc.createElement('direction');
        d.setAttribute('placement', 'above');
        const dt = doc.createElement('direction-type');
        const w = doc.createElement('words');
        w.setAttribute('font-weight', 'bold');
        w.appendChild(doc.createTextNode(e.label));
        dt.appendChild(w);
        d.appendChild(dt);
        m.insertBefore(d, m.firstChild);
      }
      if (e.pass > 0) {
        const p = doc.createElement('print');
        p.setAttribute('new-page', 'yes');
        m.insertBefore(p, m.firstChild);
      }
    }
    m.setAttribute('number', String(i + 1));
    return m;
  });

  // Final barline on the last measure.
  const last = clones[clones.length - 1];
  const bar = doc.createElement('barline');
  bar.setAttribute('location', 'right');
  const style = doc.createElement('bar-style');
  style.appendChild(doc.createTextNode('light-heavy'));
  bar.appendChild(style);
  last.appendChild(bar);

  // Swap the measures under the part.
  for (const m of measures) part.removeChild(m);
  for (const c of clones) part.appendChild(c);

  const body = serializeDoc(doc).replace(/^<\?xml[^>]*\?>\s*/, '');
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<!-- GENERATED by scripts/remix from remixes/${recipe.songId}.${recipe.variantId}.remix.json - do not hand-edit -->\n` +
    body +
    '\n'
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run scripts/remix/compile.test.ts`
Expected: PASS (8 tests). If the volta-collapse or unroll fingerprints mismatch, debug against the fixture's structure — do not weaken the assertions.

- [ ] **Step 5: Run the whole suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add scripts/remix/compile.ts scripts/remix/compile.test.ts
git commit -m "feat(remix): deterministic pass expansion — repeats, voltas, endWith, lyric lines, page breaks"
```

---

### Task 6: Compiler — build CLI + npm scripts

**Files:**
- Create: `scripts/remix/build.ts`
- Modify: `package.json` (scripts)

**Interfaces:**
- Consumes: `compileRemix` (Task 5).
- Produces: `npm run remix:build [-- <songId>.<variantId>]` writes variants; `npm run remix:check` exits non-zero if any committed variant differs from a fresh compile (or is missing). Recipe files live at `public/songs/remixes/<songId>.<variantId>.remix.json`; outputs at `public/songs/<songId>.<variantId>.musicxml`.

- [ ] **Step 1: Write the CLI**

```ts
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
```

- [ ] **Step 2: Add the npm scripts**

In `package.json` `scripts`, after `"corrections:resolve"`:

```json
    "remix:build": "tsx scripts/remix/build.ts",
    "remix:check": "tsx scripts/remix/build.ts --check",
```

- [ ] **Step 3: Verify both modes run clean with no recipes yet**

Run: `npm run remix:build && npm run remix:check`
Expected: both print `no recipes found — nothing to do`, exit 0.

- [ ] **Step 4: Commit**

```bash
git add scripts/remix/build.ts package.json
git commit -m "feat(remix): build CLI — remix:build writes variants, remix:check gates drift"
```

---

### Task 7: Wabash — section labels, first recipe, golden test, manifest

**Files:**
- Modify: `public/songs/wabash-cannonball.musicxml` (add rehearsal marks only — no note changes)
- Create: `public/songs/remixes/wabash-cannonball.july-gig.remix.json`
- Generate + commit: `public/songs/wabash-cannonball.july-gig.musicxml`
- Create: `scripts/remix/wabash.golden.test.ts`
- Modify: `public/library.json`

**Interfaces:**
- Consumes: everything from Tasks 3–6.
- Produces: the first real, deployable variant; the golden test that keeps `npm test` honest about drift.

> **Human gate:** this task changes a real song. David verifies the labeled canonical AND the compiled variant by ear on the dev server before the PR merges (README rule for song changes).

- [ ] **Step 1: Map Wabash's form and add section labels**

The canonical has 16 measures, one forward repeat (measure 1) and three backward-repeat + volta-1/2 groups (grep `<repeat` / `<ending` to see them: groups end near lines 327, 928, 1766). Each repeated span is a section. Read the measure numbers that carry `<repeat direction="forward">`, `<ending ... type="start">`, and `<repeat direction="backward">`, and insert a rehearsal mark at the first measure of each repeat group, as the first child of that `<measure>`:

```xml
<direction placement="above">
  <direction-type><rehearsal>part-1</rehearsal></direction-type>
</direction>
```

Label them `part-1`, `part-2`, `part-3` in score order (rename later if David prefers verse/chorus names — labels are just strings). The structure parser enforces that each repeat group sits inside one section, so `parseStructure` failing is the signal a mark is misplaced.

(Scope note: the spec's structure audit covers all songs; this plan labels only Wabash — the one song with a recipe. The other three get labels with their first recipe, since unlabeled songs compile-error loudly rather than misbehave.)

Verify: `npx tsx -e "import {loadDoc,parseStructure} from './scripts/remix/structure.ts'; import {readFileSync} from 'node:fs'; console.log(JSON.stringify(parseStructure(loadDoc(readFileSync('public/songs/wabash-cannonball.musicxml','utf8'))).sections.map(s=>({label:s.label,start:s.start,end:s.end,endings:s.endings.length})),null,1))"`
Expected: 3 labeled sections covering measures 1–16, each with 1–2 endings, no parse error.

- [ ] **Step 2: Write the recipe (instrumental passes only — lyric pages arrive with sub-project 2)**

`public/songs/remixes/wabash-cannonball.july-gig.remix.json`:

```json
{
  "songId": "wabash-cannonball",
  "variantId": "july-gig",
  "name": "July gig (instrumental)",
  "passes": [
    { "label": "Page 1", "repeats": "off", "endWith": "part-1" },
    { "label": "Page 2", "repeats": "off", "endWith": "part-2" }
  ]
}
```

(This is the draft David reviews by ear; adjusting pass order/sections at PR review is expected and cheap — edit JSON, re-run the build.)

- [ ] **Step 3: Build and check**

Run: `npm run remix:build && npm run remix:check`
Expected: `built public/songs/wabash-cannonball.july-gig.musicxml`, then `✓ ... up to date`.

- [ ] **Step 4: Write the golden test**

```ts
// scripts/remix/wabash.golden.test.ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { compileRemix } from './compile';

/** Drift guard: the committed variant chart must be exactly what its recipe
 *  compiles to from the current canonical. Fails => run `npm run remix:build`
 *  and re-verify the chart by ear. */
describe('wabash-cannonball.july-gig golden', () => {
  it('committed chart matches a fresh compile', () => {
    const recipe = JSON.parse(
      readFileSync('public/songs/remixes/wabash-cannonball.july-gig.remix.json', 'utf8'),
    );
    const canonical = readFileSync('public/songs/wabash-cannonball.musicxml', 'utf8');
    const committed = readFileSync('public/songs/wabash-cannonball.july-gig.musicxml', 'utf8');
    expect(compileRemix(canonical, recipe)).toBe(committed);
  });
});
```

Run: `npx vitest run scripts/remix/wabash.golden.test.ts`
Expected: PASS.

- [ ] **Step 5: Add manifest entries**

In `public/library.json`, add to the `wabash-cannonball` song object (after `"parts"`):

```json
      "variants": [
        {
          "id": "july-gig",
          "name": "July gig (instrumental)",
          "notes": "Two-page instrumental arrangement: full form closing on part 1, then full form closing on part 2."
        }
      ]
```

And in the `rehearsal-set` set list, after the existing wabash entry:

```json
   {
    "songId": "wabash-cannonball",
    "variantId": "july-gig"
   },
```

Run: `npm test`
Expected: PASS — manifest integrity tests now exercise the variant path for real.

- [ ] **Step 6: Verify in a real browser (human gate)**

Run: `npm run dev` — after Task 9 lands this is pickable in-app; at this point verify directly: open `http://localhost:5173/?song=wabash-cannonball` (canonical labeled) and confirm it renders and sounds unchanged. **Flag for David:** play the canonical through; the compiled variant gets its in-app ear-check after Task 9.

- [ ] **Step 7: Commit**

```bash
git add public/songs/wabash-cannonball.musicxml public/songs/remixes/ public/songs/wabash-cannonball.july-gig.musicxml public/library.json scripts/remix/wabash.golden.test.ts
git commit -m "feat(songs): label Wabash sections; first remix — july-gig instrumental 2-pager + golden test"
```

---

### Task 8: App wiring — variant-aware open, sync, URL, resume

**Files:**
- Modify: `src/App.svelte`
- Modify: `src/views/BrowseView.svelte`
- Modify: `src/session/types.ts` (comment only)

**Interfaces:**
- Consumes: `parseSongRef`/`formatSongRef`/`songFilePath` (Task 1), `getVariant`/`getSetListItems` (Task 2).
- Produces (used by Task 9): `showSong(s: SongSummary, variantId?: string)` and `openSong(s: SongSummary, variantId?: string)` in App.svelte; `current` gains `variantId?: string; variantName?: string; variants?: SongVariant[]`; `BrowseView` prop `onopen: (song: SongSummary, variantId?: string) => void`.

- [ ] **Step 1: Document the ref convention on the shared intent**

In `src/session/types.ts`, extend the `SharedSongIntent` doc comment:

```ts
/** The doc value at session.song. `author` is the display name, for the switch notice.
 *  `songId` carries a song REF (`<songId>` or `<songId>@<variantId>`, see
 *  src/library/songRef.ts) so arrangement switches sync like song switches; clients
 *  that can't resolve a ref ignore it, same as an unknown song id. */
```

- [ ] **Step 2: Make App.svelte ref-aware**

In `src/App.svelte`:

Add imports:

```ts
  import { parseSongRef, formatSongRef, songFilePath } from './library/songRef';
  import type { SongVariant } from './library/types';
```

Extend `current` (line ~65):

```ts
  let current = $state<{ id: string; url: string; title: string; key?: SongKey; composer?: string; notes?: string; lyricsUrl?: string; variantId?: string; variantName?: string; variants?: SongVariant[] } | undefined>(undefined);
```

Replace `showSong` and `openSong`:

```ts
  // Render a song, optionally as a named arrangement (no history or session side
  // effects — used by open, Back/Forward, boot resume, and remote follows alike).
  function showSong(s: SongSummary, variantId?: string) {
    // Unknown variant (library version drift): fall back to canonical, loudly.
    const variant = variantId ? (service?.getVariant(s.id, variantId) ?? null) : null;
    if (variantId && !variant) console.warn(`Unknown arrangement ${s.id}@${variantId}; showing canonical`);
    current = {
      id: s.id,
      url: `${import.meta.env.BASE_URL}${songFilePath(s.id, variant?.id)}${v}`,
      title: s.title,
      key: s.defaultKey,
      composer: s.composer,
      notes: s.notes,
      lyricsUrl: s.content.hasLyrics ? `${import.meta.env.BASE_URL}songs/${s.id}.chordpro${v}` : undefined,
      variantId: variant?.id,
      variantName: variant?.name,
      variants: s.variants,
    };
    pickerOpen = false; // switching a song closes the picker; we stay in the drill view
    saveLastSong(formatSongRef(s.id, variant?.id));
  }

  function openSong(s: SongSummary, variantId?: string) {
    const ref = formatSongRef(s.id, variantId);
    history.pushState(null, '', location.pathname + searchWithSong(location.search, ref));
    // The one path that publishes the switch to the band (playback-sync D6): boot
    // resume, deep links, and Back/Forward render via showSong() and stay local.
    store.setCurrentSong(ref);
    showSong(s, variantId);
  }
```

Update the song follower `apply` (the intent's `songId` is now a ref):

```ts
    apply(intent) {
      const ref = parseSongRef(intent.songId);
      if (!service || intent.songId === formatSongRef(current?.id ?? '', current?.variantId)) return;
      const s = service.getSongSummary(ref.songId);
      if (!s) return; // unknown id (library version drift) — ignore
      // replaceState, not pushState: Back must not walk through bandmates' switches.
      history.replaceState(null, '', location.pathname + searchWithSong(location.search, intent.songId));
      showSong(s, ref.variantId);
      remoteNotice = `${intent.author || 'A bandmate'} switched to ${s.title}`;
      clearTimeout(noticeTimer);
      noticeTimer = setTimeout(() => (remoteNotice = null), 4000);
    },
```

Boot pick (in `onMount`) — parse the ref:

```ts
      const bootRef = songFromSearch(location.search) ?? loadLastSong();
      const parsed = bootRef ? parseSongRef(bootRef) : null;
      const s = parsed ? service.getSongSummary(parsed.songId) : null;
      if (s) {
        history.replaceState(null, '', location.pathname + searchWithSong(location.search, null));
        history.pushState(null, '', location.pathname + searchWithSong(location.search, bootRef));
        showSong(s, parsed!.variantId);
      }
```

`onPop` — same parsing:

```ts
    const onPop = () => {
      const ref = songFromSearch(location.search);
      const parsed = ref ? parseSongRef(ref) : null;
      const s = parsed && service ? service.getSongSummary(parsed.songId) : null;
      if (s) showSong(s, parsed!.variantId);
      else {
        current = undefined; // back to the full-screen picker
        pickerOpen = false;
      }
    };
```

Re-mount on arrangement change — the `{#key}` must include the variant:

```svelte
  {#key current.url}
```

(replaces `{#key current.id}` — the url changes with song, variant, and nothing else at runtime).

- [ ] **Step 3: Make BrowseView entry-aware**

In `src/views/BrowseView.svelte`:

Prop change:

```ts
    onopen: (song: SongSummary, variantId?: string) => void;
```

Replace the `shownSongs` derivation with items (variant-aware for set lists, canonical for "all"):

```ts
  type Item = { song: SongSummary; variantId?: string; variantName?: string };
  let shownItems = $derived<Item[]>(
    selected === 'all' ? allSongs.map((song) => ({ song })) : service.getSetListItems(selected),
  );
```

Update the derived totals and template to use `shownItems` (`shownSongs.length` → `shownItems.length`, `reduce((a, s) => ...)` → `reduce((a, i) => a + (i.song.durationSec ?? 0), 0)`, `every((s) => ...)` → `every((i) => i.song.durationSec !== undefined)`).

Row loop:

```svelte
        {#each shownItems as it}
          <li>
            <button class="srow" class:active={it.song.id === activeId} aria-current={it.song.id === activeId} onclick={() => onopen(it.song, it.variantId)}>
              <span class="stitle">
                {it.song.title}
                {#if it.variantName}<span class="arr">{it.variantName}</span>{/if}
                {#if it.song.id === activeId}<span class="now">▶ now</span>{/if}
              </span>
              <span class="smeta"
                >{keyLabel(it.song)} · ♩ = {it.song.defaultTempoBpm}{#if it.song.durationSec}{' · '}{fmt(it.song.durationSec)}{/if}</span
              >
              {#if it.song.id === activeId}
                <span class="prog" style="width: {(Math.min(1, Math.max(0, progress)) * 100).toFixed(1)}%"></span>
              {/if}
            </button>
          </li>
        {/each}
```

Add the row style next to `.now`:

```css
  .arr { color: var(--muted); font-size: 0.7rem; font-weight: 600; margin-left: 0.4rem; white-space: nowrap; border: 1px solid var(--line); border-radius: 999px; padding: 0.05rem 0.4rem; }
```

- [ ] **Step 4: Typecheck and test**

Run: `npm run check && npm test`
Expected: PASS, no unused-symbol or type errors (fix any missed `shownSongs` references).

- [ ] **Step 5: Verify in the browser**

Run: `npm run dev`, open http://localhost:5173:
- Rehearsal Set shows Wabash twice — plain, and with a "July gig (instrumental)" pill.
- Opening the variant row renders the 2-page flattened chart (no repeat signs, "Page 1"/"Page 2" labels, final barline) and Play works.
- `?song=wabash-cannonball%40july-gig` deep-links to the variant; reload resumes it; Back returns to the picker.

- [ ] **Step 6: Commit**

```bash
git add src/App.svelte src/views/BrowseView.svelte src/session/types.ts
git commit -m "feat(app): variant-aware song refs — open, sync, deep links, resume, set-list rows"
```

---

### Task 9: Arrangement chip in the song header

**Files:**
- Modify: `src/views/ChordChangesView.svelte`
- Modify: `src/App.svelte`

**Interfaces:**
- Consumes: `current.variantId`/`current.variants` and `openSong` (Task 8), `SongVariant` (Task 2).
- Produces: the only new UI surface — a select pill in the top header, visible only when the song has variants; changing it publishes to the band.

- [ ] **Step 1: Pass arrangement props into the view**

In `src/App.svelte`, extend the `ChordChangesView` usage:

```svelte
    <ChordChangesView
      song={current}
      {store}
      sync={{ on: bandState.on, bandName, summary: syncSummary, toggle: toggleSync, setBandName }}
      onsongs={openPicker}
      onprogress={(f) => (progress = f)}
      onvariant={(variantId) => {
        const s = service?.getSongSummary(current!.id);
        if (s) openSong(s, variantId ?? undefined);
      }}
    />
```

- [ ] **Step 2: Add the chip to ChordChangesView**

In `src/views/ChordChangesView.svelte`:

Extend the props type — `song` gains the fields App now passes, and the callback is new (add to the destructured `$props()` object and its type):

```ts
    song: { id: string; url: string; title: string; key?: { tonalCenter: string; mode: string; fifths?: number }; composer?: string; notes?: string; lyricsUrl?: string; variantId?: string; variantName?: string; variants?: import('../library/types').SongVariant[] };
    onvariant?: (variantId: string | null) => void;
```

In the top header, directly after `<h1 class="song">{song.title}</h1>` (line ~635):

```svelte
  {#if song.variants && song.variants.length > 0}
    <select
      class="arrchip"
      aria-label="Arrangement"
      title="Arrangement — changes for the whole band"
      value={song.variantId ?? ''}
      onchange={(e) => onvariant?.(e.currentTarget.value || null)}
    >
      <option value="">Canonical</option>
      {#each song.variants as v}
        <option value={v.id}>{v.name}</option>
      {/each}
    </select>
  {/if}
```

Style (add near the header styles):

```css
  .arrchip {
    flex: 0 0 auto;
    max-width: 11rem;
    font-size: 0.72rem;
    padding: 0.2rem 0.5rem;
    border: 1px solid var(--line);
    border-radius: 999px;
    background: var(--panel);
    color: var(--muted);
  }
  .arrchip:focus-visible { border-color: var(--accent); color: var(--accent); }
```

- [ ] **Step 3: Typecheck, test, verify in the browser**

Run: `npm run check && npm test` — expected PASS.
Run: `npm run dev`; open Wabash:
- Chip shows "Canonical"; songs without variants show no chip.
- Selecting "July gig (instrumental)" re-renders the 2-page chart; the URL updates to the ref; Back returns to canonical.
- With two browser tabs joined to the same band (sync on), switching the arrangement in one tab switches the other and shows the "switched to" notice.

**Flag for David:** this is the moment to play the compiled variant through by ear (README song-change gate) — form, endings, and page turns.

- [ ] **Step 4: Commit**

```bash
git add src/views/ChordChangesView.svelte src/App.svelte
git commit -m "feat(ui): arrangement chip — session-wide variant switching from the song header"
```

---

### Task 10: CI workflow + README

**Files:**
- Create: `.github/workflows/ci.yml`
- Modify: `README.md`

**Interfaces:**
- Consumes: `remix:check` (Task 6), the test suite.
- Produces: PR gate — unit tests, svelte-check, remix drift.

- [ ] **Step 1: Add the PR workflow**

```yaml
# .github/workflows/ci.yml
# PR gate: unit suite, typecheck, and remix drift (committed variant charts must
# match a fresh compile of their recipes — see scripts/remix).
name: CI
on:
  pull_request:
jobs:
  checks:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - run: npm ci
      - run: npm test
      - run: npm run check
      - run: npm run remix:check
```

- [ ] **Step 2: Document remixes in the README**

Add a section after "Multi-user sync (corrections)":

```markdown
## Remixes (arrangements)

A **remix** is a named gig arrangement of a song — same notes, different form
(pass order, repeats, endings, later lyric verses). It's authored as a small
recipe JSON in `public/songs/remixes/<songId>.<variantId>.remix.json` and
compiled offline into an ordinary chart the app loads like any song:

```bash
npm run remix:build    # recipe + canonical MusicXML → songs/<songId>.<variantId>.musicxml
npm run remix:check    # CI drift gate: committed charts must match a fresh compile
```

Both the recipe and the compiled chart are committed; regenerate (and re-verify
by ear) whenever the canonical changes. Arrangements appear in the library
manifest (`variants` on a song), can be pinned in a set list (`variantId` on an
entry), and are switched in-app from the arrangement chip in the song header —
a session-level change that syncs to the whole band. Design:
[docs/superpowers/specs/2026-07-08-song-remix-pipeline-design.md](docs/superpowers/specs/2026-07-08-song-remix-pipeline-design.md).
```

- [ ] **Step 3: Final full pass**

Run: `npm test && npm run check && npm run remix:check && npm run build`
Expected: all PASS / clean build.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/ci.yml README.md
git commit -m "ci: PR gate — tests, typecheck, remix drift; document remixes in README"
```

---

## Completion

After all tasks: push the branch, open the PR (`gh pr create`), and hand David the two by-ear checks (labeled canonical Wabash; compiled july-gig variant) plus a two-device sync check of the arrangement chip before merge. Do not merge without the ear checks — this PR changes a real song file.
