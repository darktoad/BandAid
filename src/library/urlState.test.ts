import { describe, expect, it } from 'vitest';
import { searchWithSong, songFromSearch } from './urlState';

describe('songFromSearch', () => {
  it('reads the song id', () => {
    expect(songFromSearch('?song=old-blue')).toBe('old-blue');
    expect(songFromSearch('song=old-blue')).toBe('old-blue');
  });
  it('returns null when absent or empty', () => {
    expect(songFromSearch('')).toBeNull();
    expect(songFromSearch('?other=1')).toBeNull();
    expect(songFromSearch('?song=')).toBeNull();
  });
  it('ignores other params', () => {
    expect(songFromSearch('?band=abc&song=stones-rag')).toBe('stones-rag');
  });
});

describe('searchWithSong', () => {
  it('sets and replaces the song param', () => {
    expect(searchWithSong('', 'old-blue')).toBe('?song=old-blue');
    expect(searchWithSong('?song=stones-rag', 'old-blue')).toBe('?song=old-blue');
  });
  it('clears the param and collapses to empty', () => {
    expect(searchWithSong('?song=old-blue', null)).toBe('');
  });
  it('preserves unrelated params both ways', () => {
    expect(searchWithSong('?band=abc', 'old-blue')).toBe('?band=abc&song=old-blue');
    expect(searchWithSong('?band=abc&song=old-blue', null)).toBe('?band=abc');
  });
});
