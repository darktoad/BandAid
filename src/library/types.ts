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
  defaultTempoBpm: number;
  timeSignature: string;
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
