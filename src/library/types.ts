/**
 * Library / set-list / song browsing types (M1). These mirror the browse-facing
 * fields the unified `Song` surfaces — enough to list and orient on a song without
 * parsing its MusicXML. The manifest is a bundled, read-only static asset; adding a
 * song is a manifest entry plus a `songs/<id>.musicxml` file, no app code change.
 */

export interface SongContent {
  hasMelody: boolean;
  hasChords: boolean;
  hasTab: boolean;
  hasLyrics?: boolean; // a songs/<id>.chordpro lyrics sidecar exists
}

export interface SongPart {
  instrument: string;
  notationType: 'notation' | 'tab';
}

export interface SongKey {
  fifths: number;
  mode: string;
  tonalCenter: string;
}

export interface SongSummary {
  id: string;
  title: string;
  defaultKey: SongKey;
  /** Curated composer/attribution credit for the masthead (e.g. "Traditional",
   *  "Charlie Bowman"). Preferred over the score's credit, which export toolchains
   *  often stamp with their own name. */
  composer?: string;
  defaultTempoBpm: number;
  timeSignature: string;
  /** Played running time for one pass through the chart, in seconds (for set-length
   *  estimates). Optional — absent when not yet computed. */
  durationSec?: number;
  /** Short performance/banter note shown with the song; rendered with line breaks. */
  notes?: string;
  content: SongContent;
  parts: SongPart[];
}

/** Ordered reference into the library. Optional per-gig overrides exist in the data
 *  shape (unified-music-model) but have no MVP UI. */
export interface SetListEntry {
  songId: string;
  keyOverride?: SongKey;
  tempoOverride?: number;
}

export interface SetList {
  id: string;
  name: string;
  entries: SetListEntry[];
}

export interface LibraryManifest {
  songs: SongSummary[];
  setLists: SetList[];
}
