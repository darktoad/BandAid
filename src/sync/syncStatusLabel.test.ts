import { describe, it, expect } from 'vitest';
import { summarizeSyncStatus } from './syncStatusLabel';

describe('summarizeSyncStatus', () => {
  it('reports local-only when every provider is unavailable (solo mode)', () => {
    expect(summarizeSyncStatus({ providers: { indexeddb: 'unavailable' } })).toEqual({
      label: 'Local only',
      tone: 'local',
    });
  });

  it('reports synced when any provider is connected', () => {
    expect(
      summarizeSyncStatus({ providers: { indexeddb: 'unavailable', webrtc: 'disconnected', partyserver: 'connected' } }),
    ).toEqual({ label: 'Synced', tone: 'synced' });
  });

  it('reports connecting when nothing is connected yet but something is trying', () => {
    expect(summarizeSyncStatus({ providers: { webrtc: 'connecting', partyserver: 'disconnected' } })).toEqual({
      label: 'Connecting…',
      tone: 'connecting',
    });
  });

  it('reports "Only you" when attached but nobody else is in the room (steady state, not liminal)', () => {
    expect(summarizeSyncStatus({ providers: { indexeddb: 'unavailable', webrtc: 'alone' } })).toEqual({
      label: 'Only you',
      tone: 'local',
    });
  });

  it('something genuinely in flight outranks alone (a dialing relay reads Connecting…)', () => {
    expect(summarizeSyncStatus({ providers: { webrtc: 'alone', partyserver: 'connecting' } })).toEqual({
      label: 'Connecting…',
      tone: 'connecting',
    });
  });

  it('a connected provider outranks alone', () => {
    expect(summarizeSyncStatus({ providers: { webrtc: 'alone', partyserver: 'connected' } })).toEqual({
      label: 'Synced',
      tone: 'synced',
    });
  });

  it('reports offline when every real provider has disconnected', () => {
    expect(summarizeSyncStatus({ providers: { webrtc: 'disconnected', partyserver: 'disconnected' } })).toEqual({
      label: 'Offline',
      tone: 'offline',
    });
  });
});
