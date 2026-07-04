import { describe, it, expect } from 'vitest';
import { makeCorrection, isStale, openForSong, serializeInbox } from './corrections';
import type { Correction } from './types';

const base = (over: Partial<Correction> = {}): Correction =>
  makeCorrection(
    {
      songId: 'stones-rag',
      anchor: { kind: 'point', bar: 5, beat: 1 },
      text: 'needs a tie',
      author: 'Fiddle',
      authorId: 'dev-1',
      songVersion: 'v1',
      ...over,
    } as any,
    { id: over.id ?? 'c1', now: over.createdAt ?? 1000 },
  );

describe('makeCorrection', () => {
  it('stamps id, createdAt, and open status', () => {
    const c = makeCorrection(
      { songId: 's', anchor: { kind: 'point', bar: 2, beat: 1 }, text: 't', author: 'A', authorId: 'd', songVersion: 'v1' },
      { id: 'abc', now: 42 },
    );
    expect(c).toMatchObject({ id: 'abc', createdAt: 42, status: 'open', songId: 's' });
  });
});

describe('isStale', () => {
  it('is stale when the song version moved on', () => {
    expect(isStale(base({ songVersion: 'v1' }), 'v2')).toBe(true);
    expect(isStale(base({ songVersion: 'v2' }), 'v2')).toBe(false);
  });
});

describe('openForSong', () => {
  it('keeps only open corrections for the song', () => {
    const list = [
      base({ id: 'a', songId: 'x', status: 'open' }),
      base({ id: 'b', songId: 'x', status: 'applied' }),
      base({ id: 'c', songId: 'y', status: 'open' }),
    ];
    expect(openForSong(list, 'x').map((c) => c.id)).toEqual(['a']);
  });
});

describe('serializeInbox', () => {
  it('groups open pins by song, marks stale, sorts bottom-up', () => {
    const list = [
      base({ id: 'lo', songId: 'x', anchor: { kind: 'point', bar: 3, beat: 1 }, songVersion: 'v1' }),
      base({ id: 'hi', songId: 'x', anchor: { kind: 'range', startBar: 9, endBar: 12 }, songVersion: 'v2' }),
    ];
    const inbox = serializeInbox(list, 'v2');
    expect(inbox.songs.x.map((e) => e.id)).toEqual(['hi', 'lo']); // bar 9 before bar 3
    expect(inbox.songs.x.find((e) => e.id === 'lo')!.stale).toBe(true);
    expect(inbox.generatedAt).toBeNull();
  });
});
