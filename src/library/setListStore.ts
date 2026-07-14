import * as Y from 'yjs';
import type { SetList } from './types';
import { createChannel } from '../sync/channel';
import {
  putSetListEntry, putSetListEntryRank, putSetListMeta, readSetLists,
  tombstoneSetList, tombstoneSetListEntry,
} from '../sync/setListsDoc';
import { mergeSetLists, type MergedSetList } from './setListMerge';
import { rankAfter, rankBetween, seedRanks } from './setListRank';

/**
 * App-facing set list editing over the shared doc (set-list editing D6). Reads are the
 * manifest/doc merge; every write is a delta in one Yjs transaction — additions, rank
 * overrides, and tombstones — never a copy of manifest data (see setListsDoc for why
 * that is what makes concurrent edits converge). Set lists are durable collaborative
 * data: writes are never gated on band sync (D5), same policy as songSettings and
 * corrections.
 */
export interface SetListStore {
  /** Subscribers get the current lists immediately, then again on every doc change. */
  subscribe(run: (lists: MergedSetList[]) => void): () => void;
  getLists(): MergedSetList[];
  /** Create an empty list at the end; returns its id (for select-and-rename flows). */
  createList(name: string): string;
  renameList(listId: string, name: string): void;
  /** Tombstones — a deleted list can never be resurrected by a stale device. */
  deleteList(listId: string): void;
  moveList(listId: string, toIndex: number): void;
  /** Appends; duplicates are allowed (the same tune twice in a set is legitimate). */
  addSong(listId: string, songId: string, variantId?: string): void;
  removeEntry(listId: string, entryId: string): void;
  moveEntry(listId: string, entryId: string, toIndex: number): void;
  destroy(): void;
}

export function createSetListStore(ydoc: Y.Doc, manifestLists: SetList[]): SetListStore {
  const getLists = () => mergeSetLists(manifestLists, readSetLists(ydoc));
  const channel = createChannel(getLists);
  const observer = () => channel.emit();
  ydoc.getMap('setLists').observe(observer);

  /** Rewrite every visible entry's rank override to evenly spread values. */
  function rebalanceEntries(listId: string, ordered: MergedSetList['entries']): void {
    const ranks = seedRanks(ordered.length);
    ordered.forEach((e, i) => putSetListEntryRank(ydoc, listId, e.entryId, ranks[i]));
  }

  const entriesOf = (listId: string) => getLists().find((l) => l.id === listId)?.entries ?? [];

  return {
    subscribe: channel.subscribe,
    getLists,

    createList(name: string): string {
      const listId = `list-${crypto.randomUUID().slice(0, 8)}`;
      ydoc.transact(() => {
        const all = getLists();
        let rank = rankAfter(all.at(-1)?.rank ?? null);
        if (rank === null) {
          // Out of room above (thousands of creates): rebalance all list ranks.
          const ranks = seedRanks(all.length + 1);
          all.forEach((l, i) => putSetListMeta(ydoc, l.id, { rank: ranks[i] }));
          rank = ranks[all.length];
        }
        putSetListMeta(ydoc, listId, { name, rank });
      });
      return listId;
    },

    renameList(listId: string, name: string): void {
      putSetListMeta(ydoc, listId, { name });
    },

    deleteList(listId: string): void {
      tombstoneSetList(ydoc, listId);
    },

    moveList(listId: string, toIndex: number): void {
      ydoc.transact(() => {
        const all = getLists();
        const moved = all.find((l) => l.id === listId);
        if (!moved) return;
        const rest = all.filter((l) => l.id !== listId);
        const i = Math.max(0, Math.min(toIndex, rest.length));
        const rank = rankBetween(rest[i - 1]?.rank ?? null, rest[i]?.rank ?? null);
        if (rank !== null) {
          putSetListMeta(ydoc, listId, { rank });
          return;
        }
        // Gap exhausted between neighbours: rebalance every list in the new order.
        rest.splice(i, 0, moved);
        const ranks = seedRanks(rest.length);
        rest.forEach((l, j) => putSetListMeta(ydoc, l.id, { rank: ranks[j] }));
      });
    },

    addSong(listId: string, songId: string, variantId?: string): void {
      ydoc.transact(() => {
        let entries = entriesOf(listId);
        let rank = rankAfter(entries.at(-1)?.rank ?? null);
        if (rank === null) {
          rebalanceEntries(listId, entries);
          entries = entriesOf(listId);
          rank = rankAfter(entries.at(-1)?.rank ?? null)!;
        }
        putSetListEntry(ydoc, listId, crypto.randomUUID(), {
          songId, rank, ...(variantId !== undefined ? { variantId } : {}),
        });
      });
    },

    removeEntry(listId: string, entryId: string): void {
      tombstoneSetListEntry(ydoc, listId, entryId);
    },

    moveEntry(listId: string, entryId: string, toIndex: number): void {
      ydoc.transact(() => {
        const entries = entriesOf(listId);
        const moved = entries.find((e) => e.entryId === entryId);
        if (!moved) return;
        const rest = entries.filter((e) => e.entryId !== entryId);
        const i = Math.max(0, Math.min(toIndex, rest.length));
        const rank = rankBetween(rest[i - 1]?.rank ?? null, rest[i]?.rank ?? null);
        if (rank !== null) {
          putSetListEntryRank(ydoc, listId, entryId, rank);
          return;
        }
        rest.splice(i, 0, moved);
        rebalanceEntries(listId, rest);
      });
    },

    destroy(): void {
      ydoc.getMap('setLists').unobserve(observer);
    },
  };
}

export type { MergedSetList, MergedEntry } from './setListMerge';
