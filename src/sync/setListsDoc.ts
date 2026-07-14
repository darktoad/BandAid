import * as Y from 'yjs';

/**
 * Set list edits in the shared doc (set-list editing D1/D2). One flat field-keyed
 * Y.Map — the songSettings pattern — holding only DELTAS against the bundled
 * manifest (which stays the read-only default; merging happens in
 * src/library/setListMerge.ts):
 *
 *   `<listId>\u0000name`                 string — rename override / doc-born list name
 *   `<listId>\u0000rank`                 string — order among lists (setListRank)
 *   `<listId>\u0000deleted`              1      — list tombstone; wins over everything
 *   `<listId>\u0000entry\u0000<id>`      object — an ADDED entry { songId, variantId?, rank }
 *   `<listId>\u0000entryRank\u0000<id>`  string — rank override (moves), seed or added
 *   `<listId>\u0000entryGone\u0000<id>`  1      — entry tombstone (removals)
 *
 * Nothing ever writes the manifest's seed entries into the doc. That is what makes
 * concurrent edits from two devices converge on the intended result: a removal is a
 * tombstone key (it can't race a peer's seed insert and resurrect), and a move is a
 * rank-override key (it can't lose a whole-value LWW against a seed write). Field
 * granularity means rename vs reorder vs removal all touch different keys and all
 * survive a merge. NUL separator for the same reason as songSettings: it can never
 * appear in an id.
 */

const SET_LISTS = 'setLists';
const SEP = '\u0000';

/** An entry added in-app (manifest entries stay virtual — see module doc). */
export interface SharedSetListEntry {
  songId: string;
  variantId?: string;
  rank: string;
}

/** One list's raw doc deltas. */
export interface DocSetList {
  name?: string;
  rank?: string;
  deleted: boolean;
  added: Map<string, SharedSetListEntry>;
  entryRanks: Map<string, string>;
  gone: Set<string>;
}

function setListsMap(doc: Y.Doc): Y.Map<unknown> {
  return doc.getMap<unknown>(SET_LISTS);
}

const isString = (v: unknown) => typeof v === 'string';
/** Synced values are untrusted input until they pass shape checks (same as songSettings). */
function asEntry(v: unknown): SharedSetListEntry | null {
  if (typeof v !== 'object' || v === null) return null;
  const r = v as Record<string, unknown>;
  if (!isString(r.songId) || !isString(r.rank)) return null;
  if (r.variantId !== undefined && !isString(r.variantId)) return null;
  return { songId: r.songId, rank: r.rank, ...(r.variantId !== undefined ? { variantId: r.variantId as string } : {}) };
}

export function readSetLists(doc: Y.Doc): Map<string, DocSetList> {
  const out = new Map<string, DocSetList>();
  const ensure = (listId: string): DocSetList => {
    let l = out.get(listId);
    if (!l) out.set(listId, (l = { deleted: false, added: new Map(), entryRanks: new Map(), gone: new Set() }));
    return l;
  };
  for (const [key, value] of setListsMap(doc).entries()) {
    const [listId, field, entryId] = key.split(SEP);
    if (!listId || !field) continue;
    if (field === 'name' && isString(value)) ensure(listId).name = value;
    else if (field === 'rank' && isString(value)) ensure(listId).rank = value;
    else if (field === 'deleted') ensure(listId).deleted = true;
    else if (field === 'entry' && entryId) {
      const entry = asEntry(value);
      if (entry) ensure(listId).added.set(entryId, entry);
    } else if (field === 'entryRank' && entryId && isString(value)) ensure(listId).entryRanks.set(entryId, value);
    else if (field === 'entryGone' && entryId) ensure(listId).gone.add(entryId);
  }
  return out;
}

export function putSetListMeta(doc: Y.Doc, listId: string, meta: { name?: string; rank?: string }): void {
  const m = setListsMap(doc);
  if (meta.name !== undefined) m.set(`${listId}${SEP}name`, meta.name);
  if (meta.rank !== undefined) m.set(`${listId}${SEP}rank`, meta.rank);
}

export function putSetListEntry(doc: Y.Doc, listId: string, entryId: string, entry: SharedSetListEntry): void {
  setListsMap(doc).set(`${listId}${SEP}entry${SEP}${entryId}`, entry);
}

/** Move an entry (seed or added): a rank override under its own key, so a concurrent
 *  rename/removal/other-entry move can never clobber it. */
export function putSetListEntryRank(doc: Y.Doc, listId: string, entryId: string, rank: string): void {
  setListsMap(doc).set(`${listId}${SEP}entryRank${SEP}${entryId}`, rank);
}

/** Remove an entry (seed or added): a tombstone, not a delete — a delete could race a
 *  peer's insert of the same key and resurrect the entry. */
export function tombstoneSetListEntry(doc: Y.Doc, listId: string, entryId: string): void {
  setListsMap(doc).set(`${listId}${SEP}entryGone${SEP}${entryId}`, 1);
}

/** Delete a list = tombstone + hygiene-clear of its other keys. The tombstone stays
 *  forever so a concurrent (or later, from a stale device) edit can never resurrect
 *  the list — reads skip everything behind it. */
export function tombstoneSetList(doc: Y.Doc, listId: string): void {
  const m = setListsMap(doc);
  doc.transact(() => {
    for (const key of [...m.keys()]) {
      if (key.startsWith(`${listId}${SEP}`)) m.delete(key);
    }
    m.set(`${listId}${SEP}deleted`, 1);
  });
}
