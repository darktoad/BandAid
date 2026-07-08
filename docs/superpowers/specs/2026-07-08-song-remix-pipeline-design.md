# Song Remix Pipeline — Design

**Date:** 2026-07-08
**Status:** Approved (brainstorm with David, 2026-07-08)
**Approach:** Recipe + offline compiler ("index card + machine")

## Problem

The band wants to "remix" songs for a set list — play a tune in a gig-specific
form without touching the music itself. Concretely (the motivating Wabash
Cannonball example):

1. **Page 1:** full form, instrumental, no repeats, close on part 1.
2. **Page 2:** from the top, verse 1 + chorus lyrics enabled, close on part 1.
3. **Page 3:** from the top, verse 2 + chorus lyrics enabled, close on part 1.
4. **Page 4:** full form, instrumental, no repeats, close out on part 2.

A remix is a **form-level recomposition over content that already exists in the
canonical MusicXML**: selecting bars/sections/parts, rewiring or disabling
repeats, inserting stops/breaks, toggling lyric verses per pass, choosing
endings. A remix **never adds notes**. If the band wants simpler chords,
inversions, special parts, or lyrics, those belong in the canonical source
file — the canonical file is the superset of everything the band knows about a
song; a remix is a derivation from it.

No full in-app edit UI. The unified-music-model boundary stands: the app never
edits or derives notation; it only consumes canonical MusicXML.

## Decisions made in brainstorming

| Decision | Choice | Rationale |
|---|---|---|
| Remix scope | Form recomposition only (bars/sections, repeats, stops, verse toggles, endings, key/tempo/feel) | No new notes; content additions go in the canonical file |
| Distribution | Staged: repo pipeline (chat → PR → deploy) now; runtime upload via sync layer later, enabled by the recipe format | Repo gives versioning, review-by-ear, zero new infra; recipe JSON is the natural future sync payload |
| Identity | A remix is a **named arrangement (variant) of a song**, not a sibling song | One "Wabash Cannonball" in the library; corrections stay associated; set lists pick an arrangement |
| Architecture | **Recipe + deterministic offline compiler** (Approach C) — not freeform AI-baked charts (A), not in-app runtime expansion (B) | App boundary intact; no drift (regeneration is deterministic); AI's job shrinks to writing a small checkable recipe |
| Lyrics | **MusicXML becomes the single definitive source, including lyrics.** The separate ChordPro lyrics sheet will be retired. Split out as sub-project 2 | Presentation (in-notation vs chord-overlay extension) is open and needs visual prototypes |
| Key/tempo | Stay on `SetListEntry.keyOverride`/`tempoOverride` (already in the data shape) — **not** in the recipe | Recipes change *form*; set-list entries change *key/tempo*. "July arrangement, tonight in D" composes the two |
| Feel (swing/straight etc.) | Deferred — becomes recipe vocabulary if/when a real remix needs it | No motivating example yet; don't design a word nobody has asked to say |

## Scope decomposition

- **Sub-project 1 (this spec): the remix pipeline.** Recipe format, compiler,
  variants in the library manifest, set-list wiring, workflow. Fully buildable
  and testable now with instrumental remixes (pages 1 and 4 of the Wabash
  example).
- **Sub-project 2 (separate spec, later): lyrics unification.** Embed lyrics
  into canonical MusicXML, visual prototypes for presentation, retire the
  ChordPro sheet and `LyricsSheet.svelte`. Unlocks lyric-bearing passes
  (Wabash pages 2–3).

The recipe schema includes verse selection from day one so sub-project 2
requires no pipeline rework — lyric remixes start working when the canonical
files carry lyrics.

## Data model

### Manifest (`public/library.json`, `src/library/types.ts`)

```ts
interface SongVariant {
  id: string;       // e.g. "july-gig" — unique within the song
  name: string;     // e.g. "July gig 4-pager" — shown in the arrangement chip
  notes?: string;   // optional performance note
}

interface SongSummary {
  // ... existing fields unchanged ...
  variants?: SongVariant[];   // absent/empty = canonical only
}

interface SetListEntry {
  songId: string;
  variantId?: string;         // NEW — absent = canonical
  keyOverride?: SongKey;      // existing, unchanged
  tempoOverride?: number;     // existing, unchanged
}
```

### Files

| Artifact | Path | Authored by |
|---|---|---|
| Recipe (versioned source of truth for the arrangement) | `public/songs/remixes/<songId>.<variantId>.remix.json` | Claude session from plain-English description; human-readable and reviewable |
| Compiled chart (generated) | `public/songs/<songId>.<variantId>.musicxml` | `npm run remix:build` — never hand-edited |

**Both are committed.** Committing the generated chart lets a PR reviewer play
it through before merge and keeps deploy dumb. A CI check re-runs the compiler
and fails on any diff — the anti-drift guarantee (catches stale charts and
hand-edits).

## Recipe format (v1)

The Wabash example as a recipe:

```json
{
  "songId": "wabash-cannonball",
  "variantId": "july-gig",
  "name": "July gig 4-pager",
  "passes": [
    { "label": "Page 1", "repeats": "off", "lyrics": "off",
      "endWith": "part-1" },
    { "label": "Page 2", "repeats": "off",
      "lyrics": { "verse": 1, "chorus": true }, "endWith": "part-1" },
    { "label": "Page 3", "repeats": "off",
      "lyrics": { "verse": 2, "chorus": true }, "endWith": "part-1" },
    { "label": "Page 4", "repeats": "off", "lyrics": "off",
      "endWith": "part-2" }
  ]
}
```

Per-pass vocabulary (all fields optional; omitted = as written):

- `label` — pass name, rendered as a text direction at the pass start.
- `sections: ["A", "B"]` — play only these sections, in this order.
- `repeats: "off" | { "<section>": <count> }` — disable or re-count repeats.
- `lyrics: "off" | { "verse": <n>, "chorus": <bool> }` — which lyric line
  shows on this pass (no-op until sub-project 2 lands lyrics in the canonical).
- `endWith` — which ending/part closes the pass (e.g. `"part-1"`).
- `stops: [...]` — inserted stops/breaks (vocabulary defined when first needed).

The vocabulary starts with exactly what the motivating example plus the agreed
scope needs, and grows one word at a time as real remixes demand it. A remix
the schema cannot express is the signal to teach the compiler a new word — or,
as a deliberate escape hatch, hand-bake that one chart as a freeform variant
with its prompt committed as provenance.

### Prerequisite: labeled structure in canonicals

The compiler can only resolve `"part-1"` / `"verse 2"` if the canonical file
labels its structure (rehearsal marks / section boundaries). Building the
compiler includes a one-time audit of the current songs, adding section
markers where missing. This also benefits the future section-pointer feature.

## The compiler

`scripts/remix/` (TypeScript, run via `npm run remix:build`), following the
repo's existing headless-tooling pattern (`corrections:pull`).

- Operates on the MusicXML DOM directly — **no alphaTab dependency**.
- Validates the recipe against the song's actual structure first; unknown
  section, nonexistent verse, bad ending → **hard error naming the problem**.
  Never silently guesses.
- Expansion: unrolls repeats, selects measures per pass, picks the lyric line,
  stitches passes with double barlines and `new-page` breaks, stamps pass
  labels, writes the variant chart.
- **Deterministic:** same inputs → byte-identical output (stable formatting,
  no timestamps).
- `npm run remix:build` rebuilds all recipes; a `-- <songId>.<variantId>`
  filter rebuilds one.

## App changes (deliberately tiny)

1. Types: `SongVariant`, `SongSummary.variants`, `SetListEntry.variantId`.
2. Library service: resolve entry → variant file path
   (`<songId>.<variantId>.musicxml`), falling back to canonical.
3. UI: an **arrangement chip** in the song header/picker showing the loaded
   arrangement and letting a player flip between canonical and variants of the
   current song. That is the entire new UI surface.
   Flipping arrangements is a **session-level change** (part of "which song is
   loaded"), not a local presentation choice — a variant has different bars, so
   the whole band must be on the same arrangement for the shared playhead to
   mean anything. Same sync semantics as changing `currentSongId`.
4. Renderer, playhead, audio, transposition, paged auto-turn: **zero changes**
   — a variant is just another MusicXML file.

## Workflow (stage 1)

1. David tells Claude in a repo session: "For Saturday, Wabash as: full
   instrumental, then verse 1, then verse 2, then instrumental out on part 2."
2. Claude writes/edits the recipe, runs `npm run remix:build`, updates the
   manifest (variant entry + set-list entry).
3. David plays it through on the dev server — the by-ear gate the README
   already mandates for song changes.
4. PR → merge → auto-deploys to every band device.
5. When a correction later fixes the canonical, `remix:build` regenerates
   every variant of that song in the same PR. No re-prompting, no drift.

### Stage 2 (out of scope, designed-for)

Runtime remix authoring synced via Yjs/PartyServer. The recipe JSON is the
contract: it becomes the synced payload, and the compiler moves in-app or into
the worker without recipes changing. Corrections pins and remixes are the same
workflow family (mark up the music → instruct the AI → new version lands);
they may converge later.

## Error handling

- **Compiler:** hard, named validation errors; no silent guessing.
- **CI:** recompile-and-diff check on every PR touching `public/songs/**` or
  `scripts/remix/**`.
- **App:** a missing variant file falls into the existing missing-song path;
  an unknown `variantId` in a set list falls back to canonical with a console
  warning.

## Testing

- Compiler unit tests (vitest) on small fixture MusicXML: repeat unrolling,
  section selection, verse pick, ending choice, pass stitching, validation
  errors.
- Golden-file test: the real Wabash recipe → committed expected output.
- Library service: variant resolution + canonical fallback.
- Determinism test: two runs, byte-identical.

## Out of scope

- Any in-app editing/authoring UI beyond the arrangement chip.
- Runtime recipe distribution (stage 2).
- Lyrics embedding and presentation (sub-project 2).
- New musical content (notes, harmonies, medley stitching) — canonical-file
  work, done upstream.
- Retiring corrections pins — possible later convergence, decided separately.
