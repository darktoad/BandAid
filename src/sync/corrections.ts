import type { Correction, NewCorrection, InboxFile, InboxEntry } from './types';

export function makeCorrection(
  input: NewCorrection & { status?: Correction['status'] },
  opts: { id?: string; now?: number } = {},
): Correction {
  const { status, ...rest } = input;
  return {
    ...rest,
    id: opts.id ?? crypto.randomUUID(),
    createdAt: opts.now ?? Date.now(),
    status: status ?? 'open',
  };
}

export function isStale(c: Correction, currentSongVersion: string): boolean {
  return c.songVersion !== currentSongVersion;
}

export function openForSong(list: Correction[], songId: string): Correction[] {
  return list.filter((c) => c.songId === songId && c.status === 'open');
}

/** First bar an anchor touches — used to sort resolution work bottom-up. */
function anchorBar(c: Correction): number {
  return c.anchor.kind === 'point' ? c.anchor.bar : c.anchor.startBar;
}

export function serializeInbox(list: Correction[], currentSongVersion: string): InboxFile {
  const songs: Record<string, InboxEntry[]> = {};
  for (const c of list.filter((x) => x.status === 'open')) {
    (songs[c.songId] ??= []).push({ ...c, stale: isStale(c, currentSongVersion) });
  }
  // Bottom-up: highest bar first, so applying an edit doesn't shift lower bar numbers.
  for (const songId of Object.keys(songs)) {
    songs[songId].sort((a, b) => anchorBar(b) - anchorBar(a));
  }
  return { generatedAt: null, songs };
}
