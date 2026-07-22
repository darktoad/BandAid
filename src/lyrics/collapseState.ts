import type { LyricSection } from './chordpro';
import { readItem, writeItem, safeStorage, type StorageLike } from '../sync/storage';

/**
 * Collapsed lyric sections — a PERSONAL view preference, per song, per device. Never
 * synced: which sections you've folded away is how you happen to be reading tonight,
 * not a decision about the arrangement. Canonical songs open everything; you collapse
 * what you don't need, and a long sheet fits at a readable size instead of shrinking.
 */

const KEY_PREFIX = 'bandaid.lyricsCollapsed.';

/** The performance note's own key (it collapses like a section). */
export const NOTE_KEY = '__note__';

/**
 * Identity for a section, stable across edits to the sheet: its label plus which
 * occurrence of that label it is ("Chorus#2"), so inserting a verse doesn't shift
 * every collapse state the way positional keys would, and repeated choruses stay
 * independently collapsible. Unlabelled sections fall back to position — there is
 * nothing else to hold on to, and a stale miss just renders expanded.
 */
export function sectionKey(section: LyricSection, index: number, all: LyricSection[]): string {
  if (!section.label) return `#${index}`;
  let occurrence = 0;
  for (let i = 0; i <= index && i < all.length; i++) {
    if (all[i].label === section.label) occurrence++;
  }
  return `${section.label}#${occurrence}`;
}

export function loadCollapsed(songId: string, storage: StorageLike | null = safeStorage()): Set<string> {
  try {
    const raw = readItem(storage, KEY_PREFIX + songId);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? new Set(parsed.filter((k): k is string => typeof k === 'string')) : new Set();
  } catch {
    return new Set(); // corrupt state must never break the sheet mid-song
  }
}

export function saveCollapsed(
  songId: string,
  collapsed: Set<string>,
  storage: StorageLike | null = safeStorage(),
): void {
  // Nothing collapsed is the default — drop the key rather than store an empty array.
  writeItem(storage, KEY_PREFIX + songId, collapsed.size > 0 ? JSON.stringify([...collapsed]) : null);
}
