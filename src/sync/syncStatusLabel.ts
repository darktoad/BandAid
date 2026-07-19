import type { SyncStatus } from './providers/attach';

export type SyncTone = 'local' | 'synced' | 'connecting' | 'offline';

/**
 * Providers with no network concept (indexeddb) report 'unavailable' and are excluded —
 * they never indicate whether the band is actually reachable, only whether local
 * durability is on (which is always true).
 *
 * Label honesty rule: liminal wording ("Connecting…") only for genuinely in-flight
 * work. 'alone' — attached and listening with nobody else in the room — is a steady
 * state and reads as one ("Only you"), in the neutral local tone.
 */
export function summarizeSyncStatus(status: SyncStatus): { label: string; tone: SyncTone } {
  const statuses = Object.values(status.providers).filter((s) => s !== 'unavailable');
  if (statuses.length === 0) return { label: 'Local only', tone: 'local' };
  if (statuses.includes('connected')) return { label: 'Synced', tone: 'synced' };
  if (statuses.includes('connecting')) return { label: 'Connecting…', tone: 'connecting' };
  if (statuses.includes('alone')) return { label: 'Only you', tone: 'local' };
  return { label: 'Offline', tone: 'offline' };
}
