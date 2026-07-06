/**
 * The one follower shape (ADR-002 D2 apply-side): every "follow the band" consumer —
 * transport stamps, song switches, and any future session key — decides WHETHER a
 * stamp applies with exactly these rules, in this order:
 *
 *  1. Own stamps advance the issuedAt cursor but never re-apply (echo guard). This
 *     runs even while following is disabled, so that on re-enable an older peer stamp
 *     can never outrank something this device did in the meantime.
 *  2. Disabled (band sync off) → ignore. Stale doc state loaded from IndexedDB at
 *     boot must never yank a device that hasn't joined the band.
 *  3. A stamp that fails the consumer's own filter (e.g. wrong song) → ignore,
 *     without touching the cursor.
 *  4. Only stamps newer than the last applied intent apply (LWW by issuedAt —
 *     compared against applied INTENTS only, never local anchor re-anchors).
 */
export interface IntentStamp {
  authorId: string;
  /** Wall-clock press time — the ONLY conflict key (ADR-002 D2.2). */
  issuedAt: number;
}

export interface IntentFollowerDeps<T extends IntentStamp> {
  /** This device's stable id — its own stamps advance the cursor but never re-apply. */
  authorId: string;
  /** Live gate: follow only while this returns true. Absent = always follow. */
  enabled?: () => boolean;
  /** Consumer-specific filter (e.g. songId match). Absent = every stamp qualifies. */
  shouldApply?: (stamp: T) => boolean;
  apply(stamp: T): void;
}

export interface IntentFollower<T extends IntentStamp> {
  receive(stamp: T | null): void;
}

export function createIntentFollower<T extends IntentStamp>(
  deps: IntentFollowerDeps<T>,
): IntentFollower<T> {
  let lastAppliedIssuedAt = 0;
  return {
    receive(stamp) {
      if (!stamp) return;
      if (stamp.authorId === deps.authorId) {
        lastAppliedIssuedAt = Math.max(lastAppliedIssuedAt, stamp.issuedAt);
        return;
      }
      if (deps.enabled && !deps.enabled()) return;
      if (deps.shouldApply && !deps.shouldApply(stamp)) return;
      if (stamp.issuedAt <= lastAppliedIssuedAt) return;
      lastAppliedIssuedAt = stamp.issuedAt;
      deps.apply(stamp);
    },
  };
}
