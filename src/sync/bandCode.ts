import type { StorageLike } from './identity';

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
  storage: StorageLike | null = safeLocal(),
): string {
  const fromUrl = new URLSearchParams(search).get('band');
  if (fromUrl && fromUrl.trim()) {
    const name = fromUrl.trim();
    try {
      storage?.setItem(KEY, name);
    } catch {
      /* ignore */
    }
    return name;
  }
  try {
    return storage?.getItem(KEY)?.trim() || DEFAULT_BAND_NAME;
  } catch {
    return DEFAULT_BAND_NAME;
  }
}

/** Persist an edited band name; blank falls back to the default. Returns what was saved. */
export function saveBandName(
  name: string,
  storage: StorageLike | null = safeLocal(),
): string {
  const cleaned = name.trim() || DEFAULT_BAND_NAME;
  try {
    storage?.setItem(KEY, cleaned);
  } catch {
    /* ignore */
  }
  return cleaned;
}

/**
 * The room code derived from a display name: case- and whitespace-insensitive so
 * "Sound Check" and "sound check" on two phones land in the same room.
 */
export function bandRoomCode(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, '-') || DEFAULT_BAND_NAME;
}

function safeLocal(): StorageLike | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}
