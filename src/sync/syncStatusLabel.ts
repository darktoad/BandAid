import type { SyncStatus } from './providers/attach';

export type SyncTone = 'local' | 'synced' | 'connecting' | 'offline';

/**
 * Providers with no network concept (indexeddb) report 'unavailable' and are excluded —
 * they never indicate whether the band is actually reachable, only whether local
 * durability is on (which is always true).
 */
export function summarizeSyncStatus(status: SyncStatus): { label: string; tone: SyncTone } {
  const statuses = Object.values(status.providers).filter((s) => s !== 'unavailable');
  if (statuses.length === 0) return { label: 'Local only', tone: 'local' };
  if (statuses.includes('connected')) return { label: 'Synced', tone: 'synced' };
  if (statuses.includes('connecting')) return { label: 'Connecting…', tone: 'connecting' };
  return { label: 'Offline', tone: 'offline' };
}
