import type { LibraryManifest, SetList, SongSummary, SongVariant } from './types';

/**
 * Read-only access over the bundled library manifest (D4). Browsing reads through this;
 * the only write the browse feature makes is `store.setCurrentSong` at Open time (D5),
 * which lives in the UI, not here. Set lists are surfaced only as the raw manifest
 * defaults (`getSetLists`) — display and editing go through the setListStore, which
 * layers the band's shared edits on top (set-list editing D1).
 */
export interface LibraryService {
  getSetLists(): SetList[];
  getAllSongs(): SongSummary[];
  getSongSummary(songId: string): SongSummary | null;
  /** Views the song offers, derived from its content flags (gates the chord-changes
   *  template when `hasChords` is false). */
  availableViews(song: SongSummary): string[];
  /** A song's declared arrangement, or null (unknown song or variant). */
  getVariant(songId: string, variantId: string): SongVariant | null;
}

/** Build a service over an in-memory manifest. Pure (no fetch) so it's unit-testable. */
export function makeLibraryService(manifest: LibraryManifest): LibraryService {
  const byId = new Map(manifest.songs.map((s) => [s.id, s]));

  return {
    getSetLists: () => manifest.setLists,
    getAllSongs: () => manifest.songs,
    getSongSummary: (songId: string) => byId.get(songId) ?? null,
    availableViews(song: SongSummary) {
      const views: string[] = [];
      if (song.content.hasChords) views.push('Chord changes');
      if (song.content.hasMelody) views.push('Melody');
      if (song.content.hasTab) views.push('Tab');
      return views;
    },
    getVariant(songId: string, variantId: string) {
      return byId.get(songId)?.variants?.find((v) => v.id === variantId) ?? null;
    },
  };
}

/** Fetch the bundled manifest (no CDN; served locally) and build the service. */
export async function createLibraryService(manifestUrl: string): Promise<LibraryService> {
  const res = await fetch(manifestUrl);
  if (!res.ok) throw new Error(`Failed to load library manifest ${manifestUrl}: ${res.status}`);
  const manifest = (await res.json()) as LibraryManifest;
  return makeLibraryService(manifest);
}

export type { LibraryManifest, SetList, SongSummary, SongVariant } from './types';
