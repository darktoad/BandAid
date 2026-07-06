// src/sync/transportFollower.ts
import type { SharedTransportIntent } from '../session/types';
import type { SkewLog } from './skewLog';

/**
 * The apply-side of ADR-002 D2: decides WHETHER a session.transport stamp applies.
 * Mechanics (seek/play/pause against the renderer) live in localTransport.applyRemote.
 * One follower per loaded song — cross-song stamps can never mis-apply, and a song
 * switch starts a fresh issuedAt cursor.
 */
export interface TransportFollowerDeps {
  songId: string;
  /** This device's stable id — its own stamps advance the cursor but never re-apply. */
  authorId: string;
  apply(stamp: SharedTransportIntent): void;
  skewLog?: SkewLog;
  now?: () => number;
}

export interface TransportFollower {
  receive(stamp: SharedTransportIntent | null): void;
}

export function createTransportFollower(deps: TransportFollowerDeps): TransportFollower {
  const now = deps.now ?? (() => Date.now());
  // Compared against applied INTENTS only — never against local anchor re-anchors,
  // which refresh at every repeat barline and would otherwise reject nearly everything
  // mid-tune (ADR-002 D2.2).
  let lastAppliedIssuedAt = 0;
  return {
    receive(stamp) {
      if (!stamp) return;
      if (stamp.authorId === deps.authorId) {
        lastAppliedIssuedAt = Math.max(lastAppliedIssuedAt, stamp.issuedAt);
        return;
      }
      if (stamp.songId !== deps.songId) return;
      if (stamp.issuedAt <= lastAppliedIssuedAt) return;
      lastAppliedIssuedAt = stamp.issuedAt;
      const receivedAt = now();
      deps.skewLog?.record({
        kind: stamp.kind,
        issuedAt: stamp.issuedAt,
        receivedAt,
        deltaMs: receivedAt - stamp.issuedAt,
      });
      deps.apply(stamp);
    },
  };
}
