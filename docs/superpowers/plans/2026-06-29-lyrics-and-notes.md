# Song Lyrics & Performance Notes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a scrollable chord+lyric sheet (ChordPro) and a short per-song performance note, surfaced as a personal, local slide-over on the drill screen.

**Architecture:** Notes are short strings in the bundled `library.json` manifest (instant, universal, no fetch). Lyrics are a per-song `public/songs/<id>.chordpro` sidecar, lazily fetched and parsed when the panel first opens. A pure parser (`src/lyrics/chordpro.ts`, no DOM — mirrors `src/chords/chordTimeline.ts`) turns ChordPro text into a `SongSheet`; a presentational `LyricsSheet.svelte` renders the note + reflowing chord-over-word sections; `ChordChangesView.svelte` owns a slide-over panel (same idiom as the song picker in `App.svelte`). Nothing is written to session/transport state.

**Tech Stack:** Svelte 5 (runes), TypeScript, Vite 6, Vitest. No new dependencies.

## Global Constraints

- **No new dependencies.** Use only Svelte 5 runes, TS, Vitest already in the repo.
- **App is a pure consumer.** No in-app authoring/editing; lyrics/notes are static assets. Adding a song's lyrics must stay data-only (a manifest flag + a `.chordpro` file), no code change.
- **Pure parser, no DOM.** `src/lyrics/chordpro.ts` must be string-only so it runs identically in Node tests and the browser (the `src/chords/chordTimeline.ts` pattern).
- **Local only.** Lyrics/notes never touch `SessionStore`/`Transport`. The panel's open state is per-device and ephemeral.
- **Lyrics format = ChordPro:** `[Chord]` inline tokens; sections via `{start_of_verse|sov[: label]}` / `{start_of_chorus|soc[: label]}` / `{end_of_verse|eov}` / `{end_of_chorus|eoc}`. Unknown directives are ignored.
- **Test split (match the repo):** pure logic (parser, manifest data) gets Vitest unit tests; Svelte components are verified with `npm run check` (svelte-check) + `npm run build` + the listed manual browser steps. Do **not** add a component-test framework.
- **Only Wabash Cannonball has lyrics** in this library. All four songs get a note. (Old Blue is an instrumental fiddle tune despite the name.)
- Run commands from the repo root `C:\Projects\BandAid`.

---

### Task 1: ChordPro parser + line chunker (pure logic)

**Files:**
- Create: `src/lyrics/chordpro.ts`
- Test: `src/lyrics/chordpro.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `interface ChordToken { sym: string; index: number }`
  - `interface LyricLine { chords: ChordToken[]; text: string }`
  - `interface LyricChunk { sym: string; text: string }`
  - `interface LyricSection { label?: string; kind: 'verse' | 'chorus' | 'other'; lines: LyricLine[] }`
  - `interface SongSheet { sections: LyricSection[] }`
  - `function parseChordPro(input: string): SongSheet`
  - `function lineChunks(line: LyricLine): LyricChunk[]`

- [ ] **Step 1: Write the failing tests**

Create `src/lyrics/chordpro.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { parseChordPro, lineChunks } from './chordpro';

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
    const sheet = parseChordPro('{soc}\n[C]hey\n{eoc}');
    expect(sheet.sections[0].kind).toBe('chorus');
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
});

describe('lineChunks', () => {
  it('splits a line into chord-anchored chunks, with leading text first', () => {
    const line = parseChordPro('Oh [G]say can [C]you see').sections[0].lines[0];
    expect(lineChunks(line)).toEqual([
      { sym: '', text: 'Oh ' },
      { sym: 'G', text: 'say can ' },
      { sym: 'C', text: 'you see' },
    ]);
  });

  it('a line starting with a chord has no leading empty chunk', () => {
    const line = parseChordPro('[G]hello').sections[0].lines[0];
    expect(lineChunks(line)).toEqual([{ sym: 'G', text: 'hello' }]);
  });

  it('a chord-less line is one chunk with no symbol', () => {
    const line = parseChordPro('plain').sections[0].lines[0];
    expect(lineChunks(line)).toEqual([{ sym: '', text: 'plain' }]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lyrics/chordpro.test.ts`
Expected: FAIL — `Failed to resolve import './chordpro'` (module doesn't exist yet).

- [ ] **Step 3: Write the parser implementation**

Create `src/lyrics/chordpro.ts`:

```typescript
/**
 * Pure ChordPro → SongSheet parser for the lyrics sheet.
 *
 * String-based (no DOM) so it runs identically in the browser and in Node tests —
 * the same approach as src/chords/chordTimeline.ts. Lyrics-only: performance notes live
 * in the library manifest, not here. Unknown directives are ignored, so files stay
 * compatible with standard ChordPro tooling.
 */

export interface ChordToken {
  sym: string;
  index: number; // char offset into `text` where the chord lands
}
export interface LyricLine {
  chords: ChordToken[];
  text: string;
}
/** A line split for rendering: a chord (possibly empty) and the run of text under it. */
export interface LyricChunk {
  sym: string;
  text: string;
}
export interface LyricSection {
  label?: string;
  kind: 'verse' | 'chorus' | 'other';
  lines: LyricLine[];
}
export interface SongSheet {
  sections: LyricSection[];
}

const SECTION_START = /^\{(?:start_of_(verse|chorus)|sov|soc)(?::\s*(.*?))?\}$/i;
const SECTION_END = /^\{(?:end_of_(?:verse|chorus)|eov|eoc)\}$/i;
const DIRECTIVE = /^\{.*\}$/;

/** Parse one raw line into its text (chords stripped) + chord onsets. */
function parseLine(raw: string): LyricLine {
  const chords: ChordToken[] = [];
  let text = '';
  const re = /\[([^\]]*)\]|([^[]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) {
    if (m[1] !== undefined) chords.push({ sym: m[1], index: text.length });
    else text += m[2];
  }
  return { chords, text };
}

export function parseChordPro(input: string): SongSheet {
  const sections: LyricSection[] = [];
  let current: LyricSection | null = null;

  const ensure = (): LyricSection => {
    if (!current) {
      current = { kind: 'other', lines: [] };
      sections.push(current);
    }
    return current;
  };

  for (const raw of input.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '') continue;

    const start = SECTION_START.exec(line);
    if (start) {
      const kind = start[1]?.toLowerCase() === 'chorus' || /^\{soc/i.test(line) ? 'chorus' : 'verse';
      current = { kind, label: start[2]?.trim() || undefined, lines: [] };
      sections.push(current);
      continue;
    }
    if (SECTION_END.test(line)) {
      current = null;
      continue;
    }
    if (DIRECTIVE.test(line)) continue; // ignore unknown directives

    ensure().lines.push(parseLine(raw));
  }

  return { sections };
}

/** Split a line into chord-anchored chunks for chord-over-word rendering. */
export function lineChunks(line: LyricLine): LyricChunk[] {
  const out: LyricChunk[] = [];
  const cs = line.chords;
  const first = cs[0]?.index ?? line.text.length;
  if (cs.length === 0 || first > 0) out.push({ sym: '', text: line.text.slice(0, first) });
  for (let i = 0; i < cs.length; i++) {
    const end = cs[i + 1]?.index ?? line.text.length;
    out.push({ sym: cs[i].sym, text: line.text.slice(cs[i].index, end) });
  }
  return out;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lyrics/chordpro.test.ts`
Expected: PASS (10 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lyrics/chordpro.ts src/lyrics/chordpro.test.ts
git commit -m "feat(lyrics): pure ChordPro parser + line chunker"
```

---

### Task 2: Manifest data — notes, lyrics flag, and the Wabash sidecar

**Files:**
- Modify: `src/library/types.ts` (add `notes?` to `SongSummary`, `hasLyrics?` to `SongContent`)
- Modify: `public/library.json` (notes on all 4 songs; `hasLyrics` on Wabash)
- Create: `public/songs/wabash-cannonball.chordpro`
- Test: `src/library/manifest.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `SongSummary.notes?: string`; `SongContent.hasLyrics?: boolean`; the file `public/songs/wabash-cannonball.chordpro`.

- [ ] **Step 1: Write the failing test**

Create `src/library/manifest.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import manifest from '../../public/library.json';
import type { LibraryManifest } from './types';

describe('bundled library manifest', () => {
  const m = manifest as LibraryManifest;

  it('every song carries a non-empty performance note', () => {
    for (const s of m.songs) {
      expect(typeof s.notes, `${s.id} notes`).toBe('string');
      expect((s.notes ?? '').length, `${s.id} notes`).toBeGreaterThan(0);
    }
  });

  it('only Wabash Cannonball advertises lyrics', () => {
    const withLyrics = m.songs.filter((s) => s.content.hasLyrics).map((s) => s.id);
    expect(withLyrics).toEqual(['wabash-cannonball']);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/library/manifest.test.ts`
Expected: FAIL — `notes` is `undefined` for the songs (first assertion fails). (If `resolveJsonModule` errors, that's also a fail to fix in Step 3.)

- [ ] **Step 3a: Extend the types**

In `src/library/types.ts`, change `SongContent` and `SongSummary`:

```typescript
export interface SongContent {
  hasMelody: boolean;
  hasChords: boolean;
  hasTab: boolean;
  hasLyrics?: boolean; // a songs/<id>.chordpro lyrics sidecar exists
}
```

Add the `notes` field to `SongSummary` (place it after `durationSec?`):

```typescript
  durationSec?: number;
  /** Short performance/banter note shown with the song; rendered with line breaks. */
  notes?: string;
  content: SongContent;
```

- [ ] **Step 3b: Add the data to `public/library.json`**

Add a `"notes"` field to each of the four song objects (and `"hasLyrics": true` inside Wabash's `content`). Exact values:

- `stones-rag` → `"notes": "Named for old-time fiddler Oscar Stone, this is a bright, showy rag — ragtime's bounce run through string-band fiddle. No words, just a tune made to move a dance floor; Texas fiddle great Byron Berline helped carry it into the contest and jam-session world, where it also goes by 'Lone Star Rag.'"`
- `east-tennessee-blues` → `"notes": "Written by Charlie Bowman, a champion fiddler from the East Tennessee hills, and first recorded in 1926 with the Hill Billies — the band whose very name helped christen 'hillbilly' music. It's a fiddle 'blues' that struts more than it mourns: bluesy color over a cheerful old-time rag."`
- `wabash-cannonball` → `"notes": "The song came first; the train came second. For years the 'Wabash Cannonball' was pure tall tale — in hobo lore a ghostly death-train that carried a departed soul to its reward, its whistle heard at every station in America. It got so popular that in 1949 a railroad finally hung the name on a real express. Roy Acuff's 1936 record sold ten million copies, and it's the oldest song in the Rock and Roll Hall of Fame's '500 Songs That Shaped Rock and Roll.'"` AND set its `content` to `{ "hasMelody": true, "hasChords": true, "hasTab": false, "hasLyrics": true }`
- `old-blue` → `"notes": "A high-spirited old-time fiddle breakdown — all drive and double-stops, the kind of tune that lives in jam sessions rather than on record."`

Keep all existing fields (`id`, `title`, `defaultKey`, `defaultTempoBpm`, `timeSignature`, `content`, `parts`, `durationSec`). Validate the file is still valid JSON.

- [ ] **Step 3c: Create the Wabash lyrics sidecar**

Create `public/songs/wabash-cannonball.chordpro`:

```
{start_of_verse: Verse 1}
[G]From the great Atlantic Ocean to the [C]wide Pacific shore,
[D]To the green old flow'ring mountains, to the [G]ice-bound Labrador,
[G]She's long and tall and handsome and [C]known quite well to all,
[D]She's the modern combination called the [G]Wabash Cannonball.
{end_of_verse}

{start_of_chorus}
[G]So listen to the jingle, the [C]jumble and the roar,
As she [D]glides along the woodlands, through the hills and by the [G]shore,
[G]Hear the mighty rush of the engine, and the [C]lonesome hoboes squall,
While [D]riding through the jungle on the [G]Wabash Cannonball.
{end_of_chorus}

{start_of_verse: Verse 2}
[G]She came in from Birmingham on a [C]cold and frosty day,
As she [D]rolled into the station, you could hear the [G]people say,
"There's a [G]gal out there from Tennessee, she's [C]long, boy, and tall,
[D]She's the modern combination called the [G]Wabash Cannonball."
{end_of_verse}

{start_of_verse: Verse 3}
Now the [G]Eastern states are dandy, so [C]all the people say,
From [D]New York to Saint Louis and [G]Chicago by the way,
From the [G]lakes of Minnehaha where the [C]laughing waters fall,
No [D]change in standard gauging on the [G]Wabash Cannonball.
{end_of_verse}

{start_of_chorus}
[G]So listen to the jingle, the [C]jumble and the roar,
As she [D]glides along the woodlands, through the hills and by the [G]shore,
[G]Hear the mighty rush of the engine, and the [C]lonesome hoboes squall,
While [D]riding through the jungle on the [G]Wabash Cannonball.
{end_of_chorus}
```

- [ ] **Step 4: Run the test + typecheck to verify they pass**

Run: `npx vitest run src/library/manifest.test.ts && npm run check`
Expected: PASS (2 tests) and svelte-check `0 ERRORS`.

- [ ] **Step 5: Commit**

```bash
git add src/library/types.ts public/library.json public/songs/wabash-cannonball.chordpro src/library/manifest.test.ts
git commit -m "feat(lyrics): manifest notes for all tunes + Wabash ChordPro sidecar"
```

---

### Task 3: `LyricsSheet.svelte` renderer (presentation only)

**Files:**
- Create: `src/lyrics/LyricsSheet.svelte`

**Interfaces:**
- Consumes: `SongSheet`, `lineChunks`, `LyricLine` from `./chordpro` (Task 1).
- Produces: a Svelte component with props `{ note?: string; sheet?: SongSheet }`. Renders nothing-but-note when `sheet` is absent; renders nothing at all when both are empty.

- [ ] **Step 1: Write the component**

Create `src/lyrics/LyricsSheet.svelte`:

```svelte
<script lang="ts">
  import { lineChunks, type SongSheet } from './chordpro';

  /**
   * Presentational lyrics sheet: an optional performance note (from the manifest) on top,
   * then ChordPro sections rendered chord-over-word. Each line is split into chunks
   * (chord + the text under it) so chords reflow with the lyrics on a narrow screen.
   * Pure: no fetch, no transport — the view owns those and the slide-over chrome.
   */
  let { note, sheet }: { note?: string; sheet?: SongSheet } = $props();
</script>

{#if note}
  <p class="note">{note}</p>
{/if}

{#if sheet}
  {#each sheet.sections as section}
    <section class="sec">
      {#if section.label}<h4 class="label">{section.label}</h4>{/if}
      {#each section.lines as line}
        <div class="line">
          {#each lineChunks(line) as chunk}
            <span class="chunk">
              <span class="chord">{chunk.sym}</span>
              <span class="word">{chunk.text}</span>
            </span>
          {/each}
        </div>
      {/each}
    </section>
  {/each}
{/if}

<style>
  .note {
    margin: 0 0 1rem;
    padding-bottom: 0.9rem;
    border-bottom: 1px solid var(--line);
    color: var(--muted);
    font-size: 0.95rem;
    line-height: 1.5;
    white-space: pre-line; /* keep authored line breaks in the note */
  }
  .sec {
    margin-bottom: 1.1rem;
  }
  .label {
    margin: 0 0 0.4rem;
    font-size: 0.8rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--accent);
  }
  /* Each line is a row of inline chunks that wrap; a chunk stacks its chord over its text. */
  .line {
    display: flex;
    flex-wrap: wrap;
    margin-bottom: 0.55rem;
    line-height: 1.1;
  }
  .chunk {
    display: inline-flex;
    flex-direction: column;
  }
  .chord {
    height: 1.1em;
    font-weight: 600;
    font-size: 0.82rem;
    color: var(--accent);
  }
  .word {
    white-space: pre; /* preserve the spaces inside a chunk */
    font-size: 1rem;
    color: var(--ink);
  }
</style>
```

- [ ] **Step 2: Typecheck the component**

Run: `npm run check`
Expected: svelte-check `0 ERRORS 0 WARNINGS` (the component is imported in Task 4; a standalone unused component still type-checks clean here).

- [ ] **Step 3: Commit**

```bash
git add src/lyrics/LyricsSheet.svelte
git commit -m "feat(lyrics): LyricsSheet renderer (note + chord-over-word, reflowing)"
```

---

### Task 4: Wire the panel into the drill screen

**Files:**
- Modify: `src/App.svelte` (thread `notes` + `lyricsUrl` into the current song)
- Modify: `src/views/ChordChangesView.svelte` (prop type, state, lazy fetch, ⓘ button, slide-over panel, styles)

**Interfaces:**
- Consumes: `parseChordPro`, `SongSheet` from `../lyrics/chordpro`; `LyricsSheet` from `../lyrics/LyricsSheet.svelte`; `SongSummary.notes` / `content.hasLyrics` (Task 2).
- Produces: user-visible behavior only (no exported API).

- [ ] **Step 1: Thread the fields through `App.svelte`**

In `src/App.svelte`, widen the `current` state type and populate the two new fields in `openSong`.

Change the `current` declaration:

```typescript
  let current = $state<{ id: string; url: string; title: string; key?: SongKey; notes?: string; lyricsUrl?: string } | undefined>(undefined);
```

In `openSong`, after the existing `current = { ... }` assignment, set the fields (build the lyrics URL with the same `BASE_URL` + cache-buster as the music URL, only when the song advertises lyrics):

```typescript
    current = {
      id: s.id,
      url: `${import.meta.env.BASE_URL}songs/${s.id}.musicxml${v}`,
      title: s.title,
      key: s.defaultKey,
      notes: s.notes,
      lyricsUrl: s.content.hasLyrics ? `${import.meta.env.BASE_URL}songs/${s.id}.chordpro${v}` : undefined,
    };
```

Then pass them to the view (extend the existing `<ChordChangesView ... />`): the props are read from `song`, so no new attribute is needed — `song` already carries them once the prop type below is widened.

- [ ] **Step 2: Widen the `song` prop type in `ChordChangesView.svelte`**

In `src/views/ChordChangesView.svelte`, update the `$props()` destructure type for `song`:

```typescript
  let { song, store, onsongs, onprogress }: {
    song: { id: string; url: string; title: string; key?: { tonalCenter: string; mode: string }; notes?: string; lyricsUrl?: string };
    store: SessionStore;
    onsongs?: () => void; // open the slide-over song picker
    onprogress?: (fraction: number) => void; // 0–1 playback position, for the picker
  } = $props();
```

- [ ] **Step 3: Add imports + panel state + open/fetch logic**

In the `<script>` of `ChordChangesView.svelte`, add imports near the other lyrics/chords imports (after line 10, the `ChordOnset` import):

```typescript
  import LyricsSheet from '../lyrics/LyricsSheet.svelte';
  import { parseChordPro, type SongSheet } from '../lyrics/chordpro';
```

Add panel state near the other `$state` declarations (e.g. after `errorMsg`):

```typescript
  // Lyrics/notes slide-over: personal + local, never synced. Open state is ephemeral.
  let lyricsOpen = $state(false);
  let lyricsSheet = $state<SongSheet | null>(null);
  let lyricsLoading = $state(false);
  let lyricsError = $state<string | null>(null);
```

Add the open/close functions (near the other handlers, e.g. after `toggleCountIn`):

```typescript
  async function openLyrics() {
    lyricsOpen = true;
    // The note renders immediately from the manifest; only lyrics need a fetch, and only once.
    if (!song.lyricsUrl || lyricsSheet || lyricsLoading) return;
    lyricsLoading = true;
    lyricsError = null;
    try {
      const res = await fetch(song.lyricsUrl);
      if (!res.ok) throw new Error(`Failed to load lyrics: ${res.status}`);
      lyricsSheet = parseChordPro(await res.text());
    } catch (e) {
      lyricsError = e instanceof Error ? e.message : String(e);
    } finally {
      lyricsLoading = false;
    }
  }
  const closeLyrics = () => (lyricsOpen = false);
```

- [ ] **Step 4: Add the ⓘ button in the topbar**

In the `<header class="topbar">`, immediately after the song title span (`<span class="song">{song.title}</span>`), add a button shown only when there's something to show:

```svelte
  <span class="song">{song.title}</span>
  {#if song.notes || song.lyricsUrl}
    <button class="iconbtn" onclick={openLyrics} aria-label="Notes and lyrics" title="Notes &amp; lyrics">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="9" /><line x1="12" y1="11" x2="12" y2="16" /><circle cx="12" cy="7.5" r="1" fill="currentColor" stroke="none" />
      </svg>
    </button>
  {/if}
```

- [ ] **Step 5: Add the slide-over panel + scrim**

At the end of the markup, after the `{#if overlayOn}<ChordOverlay .../>{/if}` block (around line 450) and before the `<style>` tag, add:

```svelte
{#if lyricsOpen}
  <button class="scrim" onclick={closeLyrics} aria-label="Close lyrics"></button>
  <aside class="lyrics-panel">
    <header class="lyrics-head">
      <span>{song.title}</span>
      <button class="iconbtn" onclick={closeLyrics} aria-label="Close">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="6" y1="6" x2="18" y2="18" /><line x1="18" y1="6" x2="6" y2="18" /></svg>
      </button>
    </header>
    <div class="lyrics-body">
      {#if lyricsError}
        <p class="lyrics-msg">{lyricsError}</p>
      {:else if lyricsLoading && !lyricsSheet}
        <p class="lyrics-msg">Loading…</p>
      {:else}
        <LyricsSheet note={song.notes} sheet={lyricsSheet ?? undefined} />
      {/if}
    </div>
  </aside>
{/if}
```

- [ ] **Step 6: Add the panel styles**

Inside the `<style>` block of `ChordChangesView.svelte`, append these rules (the `.scrim` mirrors `App.svelte`'s picker so it sits above alphaTab's `z-index:1000` cursor layer):

```css
  .scrim {
    position: fixed;
    inset: 0;
    border: none;
    padding: 0;
    background: rgba(0, 0, 0, 0.5);
    z-index: 1001;
  }
  .lyrics-panel {
    position: fixed;
    top: 0;
    right: 0;
    bottom: 0;
    width: min(92%, 30rem);
    z-index: 1002;
    display: flex;
    flex-direction: column;
    background: var(--panel);
    box-shadow: -2px 0 16px rgba(0, 0, 0, 0.4);
    animation: lyrics-in 0.16s ease-out;
  }
  @keyframes lyrics-in {
    from { transform: translateX(100%); }
    to { transform: translateX(0); }
  }
  .lyrics-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    padding: 0.7rem 0.9rem;
    border-bottom: 1px solid var(--line);
    font-weight: 600;
    color: var(--ink);
  }
  .lyrics-body {
    flex: 1 1 auto;
    overflow-y: auto;
    padding: 1rem 1rem 2rem;
  }
  .lyrics-msg {
    color: var(--muted);
  }
```

- [ ] **Step 7: Typecheck and build**

Run: `npm run check && npm run build`
Expected: svelte-check `0 ERRORS 0 WARNINGS`; `vite build` completes with no errors.

- [ ] **Step 8: Manual browser verification**

Run: `npm run dev`, open the printed `http://localhost:5173`.

Verify each, and confirm no new console errors (the repo's standing bar):
1. Open **Wabash Cannonball**. An ⓘ button appears next to the title in the top bar. Click it → a slide-over opens from the right showing the performance note (the railroad/hobo paragraph) at top, then **Verse 1 / Chorus / Verse 2 / Verse 3 / Chorus**, with chord symbols (G, C, D) sitting above the right words. Narrow the window — the chords reflow with the lyrics, no fixed-column overflow.
2. Click the scrim or the ✕ → the panel closes; playback (if running) is unaffected.
3. Open **Stone's Rag** (an instrumental). The ⓘ still appears; clicking it shows **only the note** (Oscar Stone / Lone Star Rag), no verses, and triggers **no** `.chordpro` network request (check the Network tab — notes come from the manifest).
4. With **Wabash** playing, open the panel — the playhead/cursor keeps moving underneath; the panel is read-only.

- [ ] **Step 9: Commit**

```bash
git add src/App.svelte src/views/ChordChangesView.svelte
git commit -m "feat(lyrics): notes & lyrics slide-over on the drill screen"
```

---

## Self-Review notes (for the implementer)

- **Spec coverage:** Task 1 = parser/`SongSheet` (spec "Parser"); Task 2 = manifest `notes` + `hasLyrics` + sidecar (spec "Data model"); Task 3 = `LyricsSheet` (spec "renderer"); Task 4 = ⓘ affordance + lazy fetch + slide-over + `App` threading (spec "integration", "Data flow"). Forward-compat (the "B" seam) needs no code now — `LyricsSheet` already receives section `kind`/`label`; a later `currentBar` prop is additive.
- **Consolidation vs spec:** the spec described two surfaces (a lightweight note popover + a separate lyrics toggle). This plan uses **one** slide-over with a single ⓘ entry point that shows the note immediately (from the manifest, no fetch) and lazily loads lyrics only when present. Same capabilities, less surface area; the "notes need no fetch" guarantee is preserved. The spec's suggested `bandaid.lyrics` persistence is intentionally dropped — an open modal reading-panel shouldn't reappear on reload.
- **Type consistency:** `parseChordPro`/`lineChunks`/`SongSheet`/`LyricChunk` names are identical across Tasks 1, 3, 4. `song.lyricsUrl` / `song.notes` names match between `App.svelte` (Task 4 Step 1) and the view prop type (Step 2).
