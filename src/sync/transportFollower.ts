import type { SharedTransportIntent } from '../session/types';
import type { SkewLog } from './skewLog';
import { createIntentFollower, type IntentFollower } from './follower';

/**
 * The transport flavour of the intent follower (see follower.ts for the apply rules).
 * Mechanics (seek/play/pause against the renderer) live in localTransport.applyRemote.
 * One follower per loaded song — cross-song stamps can never mis-apply, and a song
 * switch starts a fresh issuedAt cursor.
 */
export interface TransportFollowerDeps {
  songId: string;
  /** This device's stable id — its own stamps advance the cursor but never re-apply. */
  authorId: string;
  /** Live gate: follow the band only while this returns true (band sync on). */
  enabled?: () => boolean;
  apply(stamp: SharedTransportIntent): void;
  skewLog?: SkewLog;
  now?: () => number;
}

export type TransportFollower = IntentFollower<SharedTransportIntent>;

export function createTransportFollower(deps: TransportFollowerDeps): TransportFollower {
  const now = deps.now ?? (() => Date.now());
  return createIntentFollower<SharedTransportIntent>({
    authorId: deps.authorId,
    enabled: deps.enabled,
    shouldApply: (stamp) => stamp.songId === deps.songId,
    apply(stamp) {
      const receivedAt = now();
      deps.skewLog?.record({
        kind: stamp.kind,
        issuedAt: stamp.issuedAt,
        receivedAt,
        deltaMs: receivedAt - stamp.issuedAt,
      });
      deps.apply(stamp);
    },
  });
}
