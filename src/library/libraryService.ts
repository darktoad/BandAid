import type { LibraryManifest, SetList, SongSummary } from './types';

/**
 * Read-only access over the bundled library manifest (D4). Browsing reads through this;
 * the only write the browse feature makes is `store.setCurrentSong` at Open time (D5),
 * which lives in the UI, not here. Set-list entries are resolved to library songs,
 * skipping (not crashing on) references to missing song ids.
 */
export interface LibraryService {
  getSetLists(): SetList[];
  getAllSongs(): SongSummary[];
  getSetListSongs(setListId: string): SongSummary[];
  getSongSummary(songId: string): SongSummary | null;
  /** Views the song offers, derived from its content flags (gates the chord-changes
   *  template when `hasChords` is false). */
  availableViews(song: SongSummary): string[];
}

/** Build a service over an in-memory manifest. Pure (no fetch) so it's unit-testable. */
export function makeLibraryService(manifest: LibraryManifest): LibraryService {
  const byId = new Map(manifest.songs.map((s) => [s.id, s]));

  return {
    getSetLists: () => manifest.setLists,
    getAllSongs: () => manifest.songs,
    getSetListSongs(setListId: string) {
      const list = manifest.setLists.find((l) => l.id === setListId);
      if (!list) return [];
      // Resolve in order; drop entries whose song id isn't in the library.
      return list.entries
        .map((e) => byId.get(e.songId))
        .filter((s): s is SongSummary => s !== undefined);
    },
    getSongSummary: (songId: string) => byId.get(songId) ?? null,
    availableViews(song: SongSummary) {
      const views: string[] = [];
      if (song.content.hasChords) views.push('Chord changes');
      if (song.content.hasMelody) views.push('Melody');
      if (song.content.hasTab) views.push('Tab');
      return views;
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

export type { LibraryManifest, SetList, SongSummary } from './types';
