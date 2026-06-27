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

- [ ] The app loads a bundled manifest and shows set lists on the home screen (set-lists-first).
- [ ] Tapping a set list shows its songs in the manifest's order, each with title/key/tempo.
- [ ] A secondary Library view lists all songs in the library.
- [ ] Tapping a song shows a detail card with key (mode/tonal center), tempo, time signature, and available views derived from content flags.
- [ ] Open sets `currentSongId` in the session store and the song loads into the renderer; no other code writes `currentSongId`.
- [ ] Back returns to the originating list.
- [ ] A song with `hasChords=false` does not list the chord-changes view on its card.
- [ ] Browsing and loading work on iPhone, Android, iPad, and laptop (web) with no network after load.

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

**Status:** Not Started
**Last Worked:** -
**Progress:** 0/8 acceptance criteria

### Implementation Notes
_Notes will be added here as implementation progresses via `/impl-feature`._

### Files Created
_Tracked here as created._

## Changelog

| Date | Change | Reason |
|------|--------|--------|
| 2026-06-26 | Initial specification | Created via /design-feature; 5 design decisions (set-lists-first, return-to-list between songs, detail card before load, read-only bundled manifest, Open sets currentSongId) |

---

_Last updated: 2026-06-26_
