// src/library/songRef.ts
/**
 * Song ref: the string identity of "what's loaded" — a canonical song
 * (`old-blue`) or a named arrangement (`wabash-cannonball@july-gig`). Refs travel
 * everywhere a song id string already travels (session doc, ?song= URL, last-song
 * localStorage) so arrangement switches sync exactly like song switches. Both id
 * segments are /^[a-z0-9-]+$/, so '@' and '.' stay unambiguous.
 */

export interface SongRef {
  songId: string;
  variantId?: string;
}

const SEP = '@';

export function formatSongRef(songId: string, variantId?: string | null): string {
  return variantId ? `${songId}${SEP}${variantId}` : songId;
}

export function parseSongRef(ref: string): SongRef {
  const i = ref.indexOf(SEP);
  if (i < 0) return { songId: ref };
  const variantId = ref.slice(i + 1);
  return variantId ? { songId: ref.slice(0, i), variantId } : { songId: ref.slice(0, i) };
}

/** File convention: canonical `songs/<id>.musicxml`; variant `songs/<id>.<variantId>.musicxml`. */
export function songFilePath(songId: string, variantId?: string | null): string {
  return variantId ? `songs/${songId}.${variantId}.musicxml` : `songs/${songId}.musicxml`;
}
