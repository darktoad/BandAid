// src/library/songRef.test.ts
import { describe, it, expect } from 'vitest';
import { formatSongRef, parseSongRef, songFilePath } from './songRef';

describe('songRef', () => {
  it('formats a canonical ref as the bare song id', () => {
    expect(formatSongRef('wabash-cannonball')).toBe('wabash-cannonball');
    expect(formatSongRef('wabash-cannonball', null)).toBe('wabash-cannonball');
  });

  it('formats a variant ref as songId@variantId', () => {
    expect(formatSongRef('wabash-cannonball', 'july-gig')).toBe('wabash-cannonball@july-gig');
  });

  it('parses a bare id and a variant ref', () => {
    expect(parseSongRef('wabash-cannonball')).toEqual({ songId: 'wabash-cannonball' });
    expect(parseSongRef('wabash-cannonball@july-gig')).toEqual({
      songId: 'wabash-cannonball',
      variantId: 'july-gig',
    });
  });

  it('round-trips', () => {
    const ref = formatSongRef('old-blue', 'slow-jam');
    expect(formatSongRef(parseSongRef(ref).songId, parseSongRef(ref).variantId)).toBe(ref);
  });

  it('treats an empty variant segment as canonical', () => {
    expect(parseSongRef('old-blue@')).toEqual({ songId: 'old-blue' });
  });

  it('builds file paths by convention', () => {
    expect(songFilePath('old-blue')).toBe('songs/old-blue.musicxml');
    expect(songFilePath('wabash-cannonball', 'july-gig')).toBe(
      'songs/wabash-cannonball.july-gig.musicxml',
    );
  });
});
