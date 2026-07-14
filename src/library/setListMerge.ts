import type { SetList } from './types';
import type { DocSetList } from '../sync/setListsDoc';
import { seedRanks } from './setListRank';

/**
 * Merge the bundled manifest's set lists (read-only defaults) with the shared doc's
 * deltas (set-list editing D1). Manifest entries stay virtual — they get deterministic
 * ids and ranks here at read time, and the doc's per-field overrides (rename, rank
 * override, tombstone, addition) layer on top. A list tombstone hides a list
 * regardless of source. Ordering is by rank with the id as a stable tie-break (two
 * devices can mint the same rank concurrently).
 */

export interface MergedEntry {
  entryId: string;
  songId: string;
  variantId?: string;
  rank: string;
}

export interface MergedSetList {
  id: string;
  name: string;
  rank: string;
  entries: MergedEntry[];
}

/** Deterministic identity for a manifest entry: every device derives the same id, so
 *  overrides written by one device apply to the same row on all of them. */
export const seedEntryId = (index: number): string => `seed-${index}`;

/** A manifest list's virtual entries: seed ids + evenly spread default ranks. */
export function seedEntries(list: SetList): MergedEntry[] {
  const ranks = seedRanks(list.entries.length);
  return list.entries.map((e, i) => ({
    entryId: seedEntryId(i),
    songId: e.songId,
    rank: ranks[i],
    ...(e.variantId !== undefined ? { variantId: e.variantId } : {}),
  }));
}

/** The rank a manifest list holds by position, unless a doc rank overrides it. */
export function manifestListRank(manifest: SetList[], index: number): string {
  return seedRanks(manifest.length)[index];
}

const byRankThenId = <T extends { rank: string }>(idOf: (t: T) => string) => (a: T, b: T) =>
  a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : idOf(a) < idOf(b) ? -1 : idOf(a) > idOf(b) ? 1 : 0;

export function mergeSetLists(manifest: SetList[], docLists: Map<string, DocSetList>): MergedSetList[] {
  const out: MergedSetList[] = [];
  const manifestIndex = new Map(manifest.map((l, i) => [l.id, i]));

  const seen = new Set<string>();
  const push = (id: string, docList: DocSetList | undefined) => {
    if (seen.has(id)) return;
    seen.add(id);
    if (docList?.deleted) return;
    const mi = manifestIndex.get(id);
    const name = docList?.name ?? (mi !== undefined ? manifest[mi].name : undefined);
    if (name === undefined) return; // orphan doc keys with no name and no manifest counterpart
    const rank = docList?.rank ?? (mi !== undefined ? manifestListRank(manifest, mi) : '');

    const base = mi !== undefined ? seedEntries(manifest[mi]) : [];
    const entries = [
      ...base,
      ...[...(docList?.added ?? new Map()).entries()].map(([entryId, e]) => ({ entryId, ...e })),
    ]
      .filter((e) => !docList?.gone.has(e.entryId))
      .map((e) => ({ ...e, rank: docList?.entryRanks.get(e.entryId) ?? e.rank }))
      .sort(byRankThenId((e) => e.entryId));

    out.push({ id, name, rank, entries });
  };

  for (const l of manifest) push(l.id, docLists.get(l.id));
  for (const [id, docList] of docLists) push(id, docList);
  return out.sort(byRankThenId((l) => l.id));
}
