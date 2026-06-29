# Design: Song lyrics & performance notes

> Brainstormed 2026-06-29. Builds on the M1 feature set (unified-music-model,
> chord-changes-view, local-transport). Status: design approved, not yet planned.

## Purpose

Give a player a scrollable **chord + lyric sheet** to read while a tune plays, plus a
short **performance note** (banter/intro talking points) per song. Both are personal,
local reference — not synced band state — consistent with the project principle:
"no modes, only a session + local presentation templates over one shared playhead."

The motivating example is *Wabash Cannonball*: multiple verses and a chorus sung over
repeats of one chord progression, with a couple of sentences of lore worth saying
between tunes.

## Decisions (from brainstorming)

| # | Decision | Rationale |
|---|----------|-----------|
| D1 | **Static read-along sheet**, data shaped so section-sync is additive later. | The canonical files are single-pass reduced lead sheets; multiple verses over repeats make timed sync (B/C) a separate, heavier project. A static sheet is immediately useful and needs zero timing data. |
| D2 | **Toggleable lyrics sheet** on the drill screen (per-device pref), like the chord overlay. | Fits the established overlay-toggle idiom; avoids pulling M3's full view-switcher forward. |
| D3 | **Lore = short plain-text performance notes**, not scholarly citations. No markdown. | It's banter to lead into / between songs — a couple of sentences, glanceable. |
| D4 | **Lyrics stored as ChordPro.** | De-facto standard for chord sheets; reflows on a phone (chords anchored to words, not columns); section directives give future section-sync for free. Pasted sheets convert to it once. |
| D5 | **One sidecar file per song** carries both notes and lyrics; lazy-fetched on open. | Keeps all human-readable song context in one place; adding lyrics stays data-only (drop a file, flip a flag), matching how songs are added (NFR-3 of unified-music-model). |

## Architecture fit

The app is a **pure consumer** (unified-music-model boundary): no in-app authoring, no
editing. Lyrics/notes are authored by hand (pasted chord sheets converted to ChordPro)
and delivered as static sidecar assets, exactly like the canonical MusicXML. Adding or
editing them requires **no app code change**.

Lyrics and notes are a **local presentation template**, never written to the session
`Transport`/`SessionState`. Two devices can have the sheet open or closed independently.

## Data model

### Manifest flag

`SongContent` (in `src/library/types.ts`) gains one optional flag:

```typescript
export interface SongContent {
  hasMelody: boolean;
  hasChords: boolean;
  hasTab: boolean;
  hasLyrics?: boolean; // a <id>.chordpro sidecar exists (lyrics and/or notes)
}
```

`public/library.json` sets `content.hasLyrics: true` on the two sung tunes
(`wabash-cannonball`, `old-blue`). The instrumental tunes are untouched.

### Sidecar file

`public/songs/<id>.chordpro` — plain ChordPro text. Optional leading `{about: …}`
directive(s) for the performance note, followed by `{start_of_verse[: label]}` /
`{start_of_chorus[: label]}` sections with `[Chord]lyric` lines.

`{about:}` is a small app-specific convention; standard ChordPro parsers ignore unknown
directives, so the files stay tool-compatible.

Example — `public/songs/wabash-cannonball.chordpro`:

```
{about: A piece of railroad history — no one knows who wrote it. The Carter Family cut it in 1929, Roy Acuff made it famous in '36. The "jungle" is the hobo camps at the edge of the train yards.}

{start_of_verse: Verse 1}
[G]From the great Atlantic ocean to the [C]wide Pacific shore,
[D]to the green old flow'ring mountains, to the [G]ice-bound Labrador
{end_of_verse}

{start_of_chorus}
[G]So listen to the jingle, the [C]jumble and the roar,
[D]as she glides along the woodlands, through the hills and by the [G]shore.
{end_of_chorus}
```

### Parsed shape

```typescript
interface ChordToken { sym: string; index: number; } // index = char offset into text
interface LyricLine  { chords: ChordToken[]; text: string; }
interface LyricSection { label?: string; kind: 'verse' | 'chorus' | 'other'; lines: LyricLine[]; }
interface SongSheet  { notes: string[]; sections: LyricSection[]; }
```

## Components & boundaries

### `src/lyrics/chordpro.ts` — pure parser

`parseChordPro(text: string): SongSheet`. String-based, no DOM, identical in browser and
Node — the exact pattern `src/chords/chordTimeline.ts` already uses, so it's unit-tested
without alphaTab/Svelte. Responsibilities:

- Pull `{about: …}` directive(s) into `notes` (multiple allowed; order preserved).
- Split into sections on `{start_of_verse|sov …}` / `{start_of_chorus|soc …}` /
  `{end_of_*}` directives; capture optional labels; default a leading label-less run to
  one `other` section.
- Per line, extract `[Chord]` tokens and record each chord's `sym` plus its `index` in
  the chord-stripped `text` (so the renderer can position chords over the right char).

What it does, how you use it, what it depends on: parses one ChordPro string into a
`SongSheet`; call it once after fetching a sidecar; depends on nothing.

### `src/lyrics/LyricsSheet.svelte` — renderer

Props: `sheet: SongSheet` (and, reserved for B, an optional `currentBar`/section map —
unused in M1). Renders:

- A **notes block** at the top (each `notes` entry as a paragraph; line breaks preserved).
- Each section: optional label, then lines where every chord is an absolutely-positioned
  span sitting above its anchor character. Lines **reflow** on a narrow viewport; a line
  with no chords renders as plain text. Empty `sheet` renders nothing.

Pure presentation; depends only on `SongSheet`. Carries no fetch/transport logic.

### `src/views/ChordChangesView.svelte` — integration

- New per-device pref (localStorage, sibling to the chord-overlay pref), e.g.
  `bandaid.lyrics = { open: boolean }`. Default closed.
- A toggle control (button) shown **only when `song.content.hasLyrics`**, plus a small
  ⓘ affordance on the masthead that opens the same sheet.
- On first open, **lazily** `fetch(<id>.chordpro)` (cache-busted like the other runtime
  fetches), `parseChordPro`, and cache the `SongSheet` in component state. Subsequent
  opens reuse it. A fetch/parse failure surfaces a quiet inline message and leaves the
  drill view fully usable.
- The sheet mounts as a scrollable **slide-over** over the notation (same overlay idiom
  as the song picker in `App.svelte`), with a close control. The playhead keeps running
  underneath; the sheet is **read-only and untimed** in M1.

### `src/App.svelte`

`openSong` adds `hasLyrics: s.content.hasLyrics` to the `current` object so the view can
gate the toggle without re-reading the manifest.

## Data flow

```
library.json (content.hasLyrics) ──► App.openSong ──► ChordChangesView (gates toggle)
                                                            │ user opens sheet (first time)
                                   fetch <id>.chordpro ──► parseChordPro ──► SongSheet
                                                            │
                                                   LyricsSheet.svelte (render, reflow)
```

No write path. Nothing touches `SessionStore`/`Transport`.

## Forward compatibility (the "B" seam)

Section-synced highlighting is purely additive on top of this design:

- ChordPro section labels already produce `LyricSection.label`/`kind`.
- The unified-music-model already defines `Section { label, startBar, endBar }`.
- B = author per-song section bar-ranges (a form map for repeats), pass `currentBar`
  into `LyricsSheet`, and highlight the matching section. **The lyric data never changes.**

## Error handling & edge cases

| Scenario | Behavior |
|----------|----------|
| `hasLyrics` true but sidecar 404s / fails to parse | Quiet inline notice in the sheet; drill view unaffected. |
| Chord positioned mid-word (`Atl[C]antic`) | Chord renders above that character; reflow still works. |
| Line with no chords | Plain lyric line. |
| Song has only a note, no verses | Sheet shows just the notes block. (Notes-only instrumentals are a later flag extension; M1 only authors the two sung tunes.) |
| Sheet open when the song is switched | Per-song remount (existing `{#key current.id}`) drops the cached sheet; reopen re-fetches. |
| Very long sheet on a phone | Sheet scrolls independently; playhead continues underneath. |

## Testing

- `src/lyrics/chordpro.test.ts` — parser: chord offsets (incl. mid-word and multiple
  chords per line), section splitting + labels, `{about}` extraction (single/multiple),
  chord-less lines, empty input.
- Manifest gating: a song with `hasLyrics` offers the toggle; one without does not.
- `LyricsSheet` rendering is thin; the parser holds the logic and carries the tests.

## Out of scope (M1)

- Section/word/line **sync** to the playhead (B/C).
- In-app authoring or editing of lyrics/notes.
- Auto-generating lyrics or notes.
- Syncing the sheet's open/scroll state across the band.

## Files

| File | Change |
|------|--------|
| `public/songs/wabash-cannonball.chordpro` | new (notes + lyrics) |
| `public/songs/old-blue.chordpro` | new (notes + lyrics) |
| `src/lyrics/chordpro.ts` | new — pure parser |
| `src/lyrics/chordpro.test.ts` | new — parser unit tests |
| `src/lyrics/LyricsSheet.svelte` | new — renderer |
| `src/library/types.ts` | add `hasLyrics?` to `SongContent` |
| `public/library.json` | set `content.hasLyrics` on the 2 sung tunes |
| `src/views/ChordChangesView.svelte` | toggle + slide-over + lazy fetch/parse + masthead ⓘ |
| `src/App.svelte` | thread `hasLyrics` into `current` |
