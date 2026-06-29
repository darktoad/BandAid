# Design: Song lyrics & performance notes

> Brainstormed 2026-06-29. Builds on the M1 feature set (unified-music-model,
> chord-changes-view, local-transport). Status: design approved, not yet planned.

## Purpose

Give a player a scrollable **chord + lyric sheet** to read while a tune plays, plus a
short **performance note** (banter/intro talking point) on **every** song — sung or
instrumental. Both are personal, local reference — not synced band state — consistent
with the project principle: "no modes, only a session + local presentation templates
over one shared playhead."

The motivating example is *Wabash Cannonball*: multiple verses and a chorus sung over
repeats of one chord progression, with a couple of sentences of lore worth saying
between tunes. Instrumentals (Stone's Rag, East Tennessee Blues) have a note but no
lyrics.

## Decisions (from brainstorming)

| # | Decision | Rationale |
|---|----------|-----------|
| D1 | **Static read-along sheet**, data shaped so section-sync is additive later. | The canonical files are single-pass reduced lead sheets; multiple verses over repeats make timed sync (B/C) a separate, heavier project. A static sheet is immediately useful and needs zero timing data. |
| D2 | **Toggleable lyrics sheet** on the drill screen (per-device pref), like the chord overlay. | Fits the established overlay-toggle idiom; avoids pulling M3's full view-switcher forward. |
| D3 | **Performance notes are short plain text**, not scholarly citations. No markdown. | It's banter to lead into / between songs — a sentence or two, glanceable. |
| D4 | **Lyrics stored as ChordPro.** | De-facto standard for chord sheets; reflows on a phone (chords anchored to words, not columns); section directives give future section-sync for free. Pasted sheets convert to it once. |
| D5 | **Notes live in the manifest (universal); lyrics live in a per-song ChordPro sidecar (sung tunes only).** | Notes are short, needed on every song (incl. instrumentals), and worth showing without a fetch or a heavy sheet → manifest metadata. Lyrics are long and only some songs have them → lazy sidecar. |

## Architecture fit

The app is a **pure consumer** (unified-music-model boundary): no in-app authoring, no
editing. Notes and lyrics are authored by hand (pasted chord sheets converted to
ChordPro) and delivered as static data — a manifest field and a sidecar asset, like the
canonical MusicXML. Adding or editing them requires **no app code change**.

Notes and lyrics are **local presentation**, never written to the session
`Transport`/`SessionState`. Two devices can have the sheet open or closed independently.

## Data model

### Manifest: universal notes + a lyrics flag

`SongSummary` (in `src/library/types.ts`) gains an optional short note; `SongContent`
gains a flag advertising a lyrics sidecar:

```typescript
export interface SongContent {
  hasMelody: boolean;
  hasChords: boolean;
  hasTab: boolean;
  hasLyrics?: boolean; // a <id>.chordpro lyrics sidecar exists
}

export interface SongSummary {
  // …existing fields…
  notes?: string; // short performance/banter note; rendered with line breaks. Universal.
}
```

`public/library.json` carries a `notes` string on **all four** songs, and
`content.hasLyrics: true` on **Wabash Cannonball only** — the one sung tune in the current
library. (Old Blue, despite sharing a name with the *Old Dog Blue* ballad, is an
instrumental fiddle breakdown in the source fakebook, with no lyrics; Stone's Rag and East
Tennessee Blues are also instrumentals.)

### Lyrics sidecar (sung tunes only)

`public/songs/<id>.chordpro` — plain ChordPro text: `{start_of_verse[: label]}` /
`{start_of_chorus[: label]}` sections with `[Chord]lyric` lines. No notes here; notes are
in the manifest.

Example — `public/songs/wabash-cannonball.chordpro`:

```
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
interface SongSheet  { sections: LyricSection[]; }
```

## Components & boundaries

### `src/lyrics/chordpro.ts` — pure parser

`parseChordPro(text: string): SongSheet`. String-based, no DOM, identical in browser and
Node — the exact pattern `src/chords/chordTimeline.ts` already uses, so it's unit-tested
without alphaTab/Svelte. Responsibilities:

- Split into sections on `{start_of_verse|sov …}` / `{start_of_chorus|soc …}` /
  `{end_of_*}` directives; capture optional labels; map to `kind` (verse/chorus/other);
  default a leading label-less run to one `other` section.
- Per line, extract `[Chord]` tokens and record each chord's `sym` plus its `index` in
  the chord-stripped `text` (so the renderer can position chords over the right char).
- Ignore unrecognized directives (forward-compatible with standard ChordPro files).

What it does, how you use it, what it depends on: parses one ChordPro string into a
`SongSheet`; call it once after fetching a sidecar; depends on nothing.

### `src/lyrics/LyricsSheet.svelte` — renderer

Props: `note?: string` (from the manifest) and `sheet: SongSheet` (and, reserved for B,
an optional `currentBar`/section map — unused in M1). Renders:

- A **note block** at the top when `note` is present (line breaks preserved).
- Each section: optional label, then lines where every chord is an absolutely-positioned
  span sitting above its anchor character. Lines **reflow** on a narrow viewport; a line
  with no chords renders as plain text. An empty `sheet` with no `note` renders nothing.

Pure presentation; depends only on its props. Carries no fetch/transport logic.

### `src/views/ChordChangesView.svelte` — integration

- **Note affordance (universal):** a small ⓘ by the masthead title, shown whenever the
  song has `notes`, opens a lightweight popover/compact sheet showing the note. No fetch
  — the note is already in the manifest. This is the only lyrics-feature surface an
  instrumental shows.
- **Lyrics toggle (sung tunes):** a toggle control shown **only when
  `song.content.hasLyrics`**, persisted per-device in localStorage (sibling to the
  chord-overlay pref), e.g. `bandaid.lyrics = { open: boolean }`, default closed.
- On first open of the lyrics sheet, **lazily** `fetch(<id>.chordpro)` (cache-busted like
  the other runtime fetches), `parseChordPro`, and cache the `SongSheet` in component
  state. Subsequent opens reuse it. A fetch/parse failure surfaces a quiet inline message
  and leaves the drill view fully usable.
- The lyrics sheet mounts as a scrollable **slide-over** over the notation (same overlay
  idiom as the song picker in `App.svelte`), with a close control, and shows the note at
  its top (passed straight from the manifest). The playhead keeps running underneath; the
  sheet is **read-only and untimed** in M1.

### `src/App.svelte`

`openSong` adds `notes: s.notes` and `hasLyrics: s.content.hasLyrics` to the `current`
object so the view can show the note + gate the lyrics toggle without re-reading the
manifest.

## Data flow

```
library.json (notes, content.hasLyrics) ──► App.openSong ──► ChordChangesView
   note shown via ⓘ (no fetch, every song) ─────────────────────┤
   lyrics toggle (only if hasLyrics) ─► fetch <id>.chordpro ─► parseChordPro ─► SongSheet
                                                                  │
                                                LyricsSheet.svelte (note + sections, reflow)
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
| Instrumental (note, no lyrics) | ⓘ note popover only; no lyrics toggle, no sidecar, no fetch. |
| Song with neither note nor lyrics | No ⓘ, no toggle (not expected in M1; all four get notes). |
| Sheet open when the song is switched | Per-song remount (existing `{#key current.id}`) drops the cached sheet; reopen re-fetches. |
| Very long sheet on a phone | Sheet scrolls independently; playhead continues underneath. |

## Testing

- `src/lyrics/chordpro.test.ts` — parser: chord offsets (incl. mid-word and multiple
  chords per line), section splitting + labels + `kind` mapping, chord-less lines,
  unknown-directive tolerance, empty input.
- Manifest gating: a song with `hasLyrics` offers the lyrics toggle; one without does
  not; every song exposes its `notes`.
- `LyricsSheet` rendering is thin; the parser holds the logic and carries the tests.

## Alternatives considered

### MusicXML as the home for lyrics/notes (rejected)

Could lyrics and notes live in the canonical MusicXML itself (one file per song) instead
of a manifest field + sidecar? Rejected for two project-specific reasons:

1. **The MusicXML is a generated, regenerable artifact**, not a hand-authored one. The
   pipeline is `ABC → Music21 toolkit → canonical MusicXML` (`tools/song-processor/`;
   every file is stamped `<creator>Music21</creator>`). Hand-edited prose/lyrics in those
   files get clobbered on the next toolkit run. Doing it "properly" would mean pushing the
   text into the ABC source and teaching the toolkit to carry it through — coupling
   human-authored banter to a music-processing pipeline. A sidecar/manifest keeps
   hand-authored content decoupled from the regenerable file.
2. **MusicXML's lyric model is note-attached** (`<lyric>` per `<note>`, verses via
   `number=`) — i.e. the karaoke model (C) we rejected, and it assumes the melody line is
   the sung vocal line. Our melodies are reduced *fiddle* lines, and the static sheet has
   multiple verses + a chorus over *repeats* of one pass; that doesn't map onto per-note
   lyrics.

Where MusicXML *would* be right: true note-synced karaoke on songs whose canonical melody
is the actual vocal line — then `<lyric>` is the standard place and alphaTab can render it
under the staff natively. Not this feature.

## Out of scope (M1)

- Section/word/line **sync** to the playhead (B/C).
- In-app authoring or editing of lyrics/notes.
- Auto-generating lyrics or notes.
- Syncing the note/sheet open/scroll state across the band.

## Files

| File | Change |
|------|--------|
| `public/library.json` | add `notes` to all 4 songs; `content.hasLyrics` on Wabash only |
| `public/songs/wabash-cannonball.chordpro` | new (lyrics) — the only sung tune for now |
| `src/lyrics/chordpro.ts` | new — pure parser |
| `src/lyrics/chordpro.test.ts` | new — parser unit tests |
| `src/lyrics/LyricsSheet.svelte` | new — renderer (note + sections) |
| `src/library/types.ts` | add `notes?` to `SongSummary`, `hasLyrics?` to `SongContent` |
| `src/views/ChordChangesView.svelte` | ⓘ note popover (universal) + lyrics toggle/slide-over + lazy fetch/parse |
| `src/App.svelte` | thread `notes` + `hasLyrics` into `current` |

## Note content (researched 2026-06-29; sources below)

Audience-facing banter: what the song is about, the world it came from, a hook of trivia,
a theme that still lands. Verified via web research; the user may still tune the voice.

- **Wabash Cannonball:** "The song came first; the train came second. For years the
  'Wabash Cannonball' was pure tall tale — in hobo lore a ghostly death-train that carried
  a departed soul to its reward, its whistle heard at every station in America. It got so
  popular that in 1949 a railroad finally hung the name on a real express. Roy Acuff's
  1936 record sold ten million copies, and it's the oldest song in the Rock and Roll Hall
  of Fame's '500 Songs That Shaped Rock and Roll.'"
- **Old Blue:** _Pending — no source found._ Confirmed instrumental: the source sheet
  (photo `IMG_6895`) carries no descriptive footnote and no lyrics — only the initials
  "F. C. Z." and personal handwriting ("for cousin Bob", "2010"). It is **not** the
  *Old Dog Blue* ballad it shares a name with, and no documented history turned up for this
  fiddle setting. Awaiting any context the user has (e.g. who "F. C. Z." is). Candidate
  descriptor if we ship something: "A high-spirited old-time fiddle breakdown — all drive
  and double-stops, the kind of tune that lives in jam sessions rather than on record."
- **Stone's Rag:** "Named for old-time fiddler Oscar Stone, this is a bright, showy rag —
  ragtime's bounce run through string-band fiddle. No words, just a tune made to move a
  dance floor; Texas fiddle great Byron Berline helped turn it into a contest and
  jam-session staple."
- **East Tennessee Blues:** "Written by Charlie Bowman, a champion fiddler from the East
  Tennessee hills, and first recorded in 1926 with the Hill Billies — the band whose very
  name helped christen 'hillbilly' music. It's a fiddle 'blues' that struts more than it
  mourns: bluesy color over a cheerful old-time rag."

Sources: Wikipedia (*Wabash Cannonball*); The Traditional Tune Archive (*Stone's Rag* →
Oscar Stone / Byron Berline arrangement; *East Tennessee Blues* → Charlie Bowman, Hill
Billies, Vocalion 5016, 1926). Old Blue: the user's file is an instrumental fiddle tune;
the *Old Dog Blue* ballad it shares a name with was confirmed **not** to match, and no
source for the fiddle setting was found — note left pending.
