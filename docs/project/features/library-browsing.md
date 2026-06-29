# Feature: Library / Set List / Song Browsing

> Specification generated on 2026-06-26
> Part of: M1 (MVP) — the shell that picks a song to drill
> Reads: [unified-music-model](unified-music-model.md) · Drives: [renderer-playhead](renderer-playhead.md)
> Stack: Svelte + TypeScript + Vite (ADR-003 to capture)

## Overview

**Purpose:** Let the player browse set lists and the library, open a song via a brief detail card, and load it into the renderer by setting `currentSongId`.

**User Story:** As the guitarist learning the rehearsal set, I want to open a set list, see its songs, glance at a song's key/tempo/available views, and load it, so I can get to drilling the right tune in a couple taps.

**Scope:** This feature covers the browse-and-select shell: a **set-lists-first** home, a secondary **Library** view of all songs, a **song detail card**, and setting `currentSongId` in the session store. Data comes from a bundled static **manifest** (library + set lists), read-only.

It explicitly does **NOT** include: creating/editing/reordering set lists (post-MVP per unified-music-model storage note), search/filter (small library in MVP), in-song next/prev navigation through a set (deferred — return to the list each time), per-gig key/tempo overrides UI (data shape exists; no MVP UI), the rendering/transport themselves (renderer-playhead, chord-changes-view, local-transport), and multiplayer set-list advance (M2).

## Core Principle Link

"No modes, only a session + local presentation templates." Browsing sets the session's `currentSongId` — part of the shared logical state. In M1 that write is local (session of one); in M2 the same write becomes multi-writer so any peer can change the current song. Which set list is open, scroll position, and the detail card are local presentation, never synced.

## Design Decisions (from /design-feature conversation, 2026-06-26)

| # | Decision | Rationale |
|---|----------|-----------|
| D1 | **Set-lists-first home; Library is a secondary view.** | The user is drilling "the set"; set lists are the primary entry. The full library stays one tap away for any-song browsing. |
| D2 | **Return to the list between songs — no in-song next/prev in M1.** | Simplest build; the drilling loop is pick → drill → back → pick. In-song set advance is a clean fast-follow and pairs with M2's shared set-list advance. |
| D3 | **Tapping a song shows a brief detail card first** (key + mode/tonal center, tempo, time signature, available views) with an Open action. | Orients the player before loading; surfaces what the song offers (content flags) so they pick the right tune. One extra tap, worth it. |
| D4 | **Read-only from a bundled static manifest; no creation/editing.** | Matches unified-music-model: MVP reads a manifest; set-list authoring + persistence is post-MVP. |
| D5 | **Open sets `currentSongId` in the session store** — the single integration point with renderer-playhead. | Keeps browsing decoupled from rendering; the store is the seam. |

## User Flow

### Primary Flow (Happy Path)

```
User Action                      System Response
──────────────────────────       ─────────────────────────────────────────────
1. Open app                  →    Home shows the set lists (name + song count).
2. Tap a set list            →    Shows its ordered songs (title, key, tempo).
3. Tap a song                →    Detail card: key+mode, tempo, time sig,
                                  available views (from content flags) + Open.
4. Tap Open                  →    store.setCurrentSong(id); renderer-playhead
                                  loads it; chord-changes-view is ready.
5. Tap back                  →    Return to the set list to pick the next song.
   (after drilling)
```

### Detailed Steps

1. **Home — set lists**
   - User: opens the app.
   - System: reads the manifest; lists set lists with name and song count.
   - UI: a tappable list of set lists; a way to reach the full Library.

2. **Set list — songs**
   - User: taps a set list.
   - System: resolves its ordered `SetListEntry` references to library songs.
   - UI: the set's songs in order, each showing title + key + tempo.

3. **Library — all songs (secondary)**
   - User: switches to the Library view.
   - System: lists every song in the library manifest.
   - UI: a scrollable list of all songs; same per-song info.

4. **Song detail card**
   - User: taps a song (from a set list or the Library).
   - System: reads the song's defaults + content flags.
   - UI: a card with title, key (explicit mode/tonal center), tempo, time signature, and which views are available (e.g. "Chord changes ✓", parts present); an Open button.

5. **Open**
   - User: taps Open.
   - System: `store.setCurrentSong(songId)`; renderer-playhead loads the canonical MusicXML.
   - UI: transitions to the chord-changes view, ready to play.

## Requirements

### Functional Requirements

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-1 | Load the library + set lists from a bundled static manifest | Must |
| FR-2 | Home shows set lists (name + song count); set-lists-first | Must |
| FR-3 | A set list shows its songs in order, resolved from library references | Must |
| FR-4 | A secondary Library view lists all songs | Must |
| FR-5 | Tapping a song shows a detail card: key (with mode/tonal center), tempo, time signature, available views | Must |
| FR-6 | The detail card derives available views from the song's content flags/parts | Must |
| FR-7 | Open sets `currentSongId` in the session store; nothing else writes it | Must |
| FR-8 | Back returns to the originating list (set list or Library) | Must |
| FR-9 | Browse/list/detail state (which list is open, scroll) is local; never synced | Must |
| FR-10 | Gracefully handle a song that offers limited views (e.g. no tab) in the detail card | Should |

### Non-Functional Requirements

| ID | Requirement | Target |
|----|-------------|--------|
| NFR-1 | Browsing works without network once the app is loaded | Manifest + canonical files are bundled/cached |
| NFR-2 | Runs on iPhone, Android, iPad, laptop (web) | All four; one code path; touch-friendly targets |
| NFR-3 | Adding a song/set list requires no app code change | Manifest + canonical file only (matches unified-music-model NFR-3) |
| NFR-4 | Library of a couple dozen songs lists instantly | No perceptible delay; no pagination needed at this size |

## Data Model

No new canonical data. Reads the manifest and `Song` defaults; writes `currentSongId`.

### Manifest (bundled static asset)

```typescript
interface LibraryManifest {
  songs: SongSummary[];     // every known song
  setLists: SetList[];      // ordered selections
}

// Lightweight summary for browsing without parsing MusicXML
// (mirrors the browse-facing fields the unified Song already surfaces).
interface SongSummary {
  id: string;
  title: string;
  defaultKey: { fifths: number; mode: string; tonalCenter: string };
  defaultTempoBpm: number;
  timeSignature: string;
  content: { hasMelody: boolean; hasChords: boolean; hasTab: boolean };
  parts: { instrument: string; notationType: 'notation' | 'tab' }[];
}

interface SetList {
  id: string;
  name: string;
  entries: SetListEntry[];  // ordered; reference songs by id
}
// SetListEntry (with optional key/tempo overrides) defined in unified-music-model.
```

### Writes (session store)

```typescript
// The only write this feature makes — the seam to renderer-playhead.
store.setCurrentSong(songId: string): void;
```

### Local-only (never synced)

```typescript
interface BrowseLocalState {
  view: 'setlists' | 'library' | 'setlist-detail' | 'song-card';
  openSetListId?: string;
  // scroll positions, etc.
}
```

## Interface (internal)

```typescript
interface LibraryService {
  loadManifest(): Promise<LibraryManifest>;
  getSetLists(): SetList[];
  getSetListSongs(setListId: string): SongSummary[];
  getAllSongs(): SongSummary[];
  getSongSummary(songId: string): SongSummary | null;
  availableViews(s: SongSummary): string[];   // derived from content flags/parts
}
```

## Edge Cases & Error Handling

| Scenario | Expected Behavior |
|----------|-------------------|
| Manifest missing/unparseable | Show a non-blocking error; app stays on a safe empty state |
| Empty library (no songs) | Empty state: "No songs yet" |
| Set list references a missing song id | Skip the missing entry, show the rest; log/flag it; don't crash the list |
| Set list is empty | Show the set list with an empty state |
| Song has no chords (`hasChords` false) | Detail card omits the chord-changes view from available views |
| Song has no tab (OCR lead sheet) | Detail card reflects available parts/views accurately (no tab views) |
| Song's canonical file fails to load on Open | renderer-playhead surfaces the error; browsing stays usable to pick another |
| Duplicate/odd file naming upstream | Manifest is the source of truth; ignore stray files not referenced by it |

## Acceptance Criteria

- [x] The app loads a bundled manifest and shows set lists on the home screen (set-lists-first).
- [x] Tapping a set list shows its songs in the manifest's order, each with title/key/tempo.
- [x] A secondary Library view lists all songs in the library.
- [x] Tapping a song shows a detail card with key (mode/tonal center), tempo, time signature, and available views derived from content flags.
- [x] Open sets `currentSongId` in the session store and the song loads into the renderer; no other code writes `currentSongId`.
- [x] Back returns to the originating list. *(Card returns to its origin — set list or Library; the drill view's ← returns to browse.)*
- [x] A song with `hasChords=false` does not list the chord-changes view on its card. *(`availableViews` gating; unit-tested.)*
- [ ] Browsing and loading work on iPhone, Android, iPad, and laptop (web) with no network after load. *(Built touch-friendly with one code path; manifest + canonical files are bundled so the loop is offline after load. On-device spot-check recommended.)*

## Dependencies

### Depends On
- **unified-music-model**: the `Song`/`SetList` contracts, content flags, and the manifest shape.
- **renderer-playhead**: the session store (`setCurrentSong`) and the renderer that loads the chosen song.
- **Bundled manifest + canonical files** (from the offline song-processing tool).

### Depended On By
- **chord-changes-view** (M1): becomes active once a song is opened.
- **Join / shared state** (M2): makes `currentSongId` multi-writer; adds shared set-list advance (in-song next/prev becomes the local half of that).

## Open Questions

- [ ] Manifest authoring: hand-written JSON for MVP, or generated by the song-processing tool? (Likely generated later; hand-written to start.)
- [ ] Exact set-lists-first layout and how the Library view is reached (tab bar vs link) — UI detail.
- [ ] Should the detail card show a tiny preview (first line / form) or just facts? (MVP: facts.)
- [ ] Do we need any sort/order in the Library view (alpha vs manifest order)? (MVP: manifest order.)

## Implementation Status

**Status:** Built (M1) — 7/8 ACs; on-device spot-check is the open item
**Last Worked:** 2026-06-29
**Progress:** 7/8 acceptance criteria. Set-lists-first home, secondary Library, song detail card, and Open→`setCurrentSong` are all wired; the only unverified AC is the cross-device spot-check (built responsive/touch-friendly, offline after load).

### Implementation Notes
- **Read-only manifest (D4):** `public/library.json` is the bundled source of truth, fetched via `BASE_URL` (no CDN; copied into `dist`). Adding a song = a manifest entry + `songs/<id>.musicxml` (NFR-3); the file URL is derived by convention from the song id.
- **Service seam:** `makeLibraryService(manifest)` is pure (unit-tested); `createLibraryService(url)` fetches then builds it. Set-list entries resolve to library songs, **skipping** references to missing ids (edge case) rather than crashing.
- **Open is the only session write (D5/FR-7):** `BrowseView` emits `onopen`; `App` calls `store.setCurrentSong(id)` and routes to the drill view. `browse`/`drill` routing and which list is open are local presentation (FR-9), never synced.
- **`availableViews` gates the chord-changes template** on `content.hasChords` (the M1 stand-in for the full content-flag-driven view list).
- Per-song re-mount (`{#key}`) makes the renderer reload the new score on Open.

### Files Created
- `public/library.json` — the bundled manifest (one tune today; widens via the song-processing tool).
- `src/library/types.ts` — manifest / summary / set-list types.
- `src/library/libraryService.ts` — `LibraryService` (`makeLibraryService` + `createLibraryService`).
- `src/library/libraryService.test.ts` — 6 tests (resolution order, missing-id skip, `availableViews` gating).
- `src/views/BrowseView.svelte` — set-lists home / Library / detail card shell.
- `src/App.svelte` — browse↔drill router; `src/views/ChordChangesView.svelte` — added a Back affordance.

## Changelog

| Date | Change | Reason |
|------|--------|--------|
| 2026-06-26 | Initial specification | Created via /design-feature; 5 design decisions (set-lists-first, return-to-list between songs, detail card before load, read-only bundled manifest, Open sets currentSongId) |
| 2026-06-29 | Implemented the browse shell + library service over a bundled manifest; Open wired to `setCurrentSong`. Marked **Built (M1)**. | Final M1 step — the shell that picks a song to drill. |
| 2026-06-29 | Widened the library to **7 tunes** (2 set lists) from the already-processed `tune-arranger` multipart samples — no processing tool needed; manifest entries + `songs/<id>.musicxml`. | Populate the library/set lists for real testing; proves the manifest-driven add-a-song path (NFR-3). |

---

_Last updated: 2026-06-26_
