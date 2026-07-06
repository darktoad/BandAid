import { readItem, writeItem, safeStorage, type StorageLike } from './storage';

const KEY = 'bandaid.band.v1';

/** The out-of-the-box band name: every fresh install shares it, so a band that just
 *  flips sync on lands in the same room without coordinating a code first. */
export const DEFAULT_BAND_NAME = 'soundcheck';

/**
 * The band name to prefill the sync settings with. A `?band=` link wins (and is
 * remembered), then the remembered name, then the default. Reading a name never
 * connects anything — sync is off until the user turns it on.
 */
export function readBandName(
  search: string,
  storage: StorageLike | null = safeStorage(),
): string {
  const fromUrl = new URLSearchParams(search).get('band')?.trim();
  if (fromUrl) {
    writeItem(storage, KEY, fromUrl);
    return fromUrl;
  }
  return readItem(storage, KEY)?.trim() || DEFAULT_BAND_NAME;
}

/** Persist an edited band name; blank falls back to the default. Returns what was saved. */
export function saveBandName(
  name: string,
  storage: StorageLike | null = safeStorage(),
): string {
  const cleaned = name.trim() || DEFAULT_BAND_NAME;
  writeItem(storage, KEY, cleaned);
  return cleaned;
}

/**
 * The room code derived from a display name: case- and whitespace-insensitive so
 * "Sound Check" and "sound check" on two phones land in the same room. The room code
 * travels inside WebSocket URL paths (PartyServer) and signaling room names, so it is
 * restricted to letters/digits/dashes — URL-hostile punctuation (`/ ? # %` …) is
 * stripped rather than escaped, keeping "Kate's Band" and "Kates Band" together too.
 */
export function bandRoomCode(name: string): string {
  const code = name
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^\p{Letter}\p{Number}-]/gu, '');
  return code.replace(/^-+|-+$/g, '') || DEFAULT_BAND_NAME;
}
