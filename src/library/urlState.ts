/**
 * Pure URL ↔ song-id mapping for deep links (`?song=<id>`). String-in/string-out so it
 * unit-tests in Node; App.svelte owns the actual history/location calls. The song param
 * coexists with future params (M2 adds `?band=<code>` join links on the same plumbing).
 */

const PARAM = 'song';

/** The song id in a search string ("?song=old-blue&x=1" → "old-blue"), or null. */
export function songFromSearch(search: string): string | null {
  const v = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search).get(PARAM);
  return v && v.length > 0 ? v : null;
}

/** The search string with the song param set (or cleared with null), others preserved.
 *  Returns '' (not '?') when nothing remains, so it can be appended to a path as-is. */
export function searchWithSong(search: string, songId: string | null): string {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  if (songId === null) params.delete(PARAM);
  else params.set(PARAM, songId);
  const s = params.toString();
  return s.length > 0 ? `?${s}` : '';
}
