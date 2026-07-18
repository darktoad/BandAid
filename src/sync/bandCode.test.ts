import { describe, it, expect } from 'vitest';
import { readBandName, saveBandName, bandRoomCode, hasSavedBandName, DEFAULT_BAND_NAME } from './bandCode';

function fakeStorage(seed: Record<string, string> = {}) {
  const m = new Map(Object.entries(seed));
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  };
}

describe('readBandName', () => {
  it('reads ?band= and remembers it', () => {
    const s = fakeStorage();
    expect(readBandName('?band=rhythm-cats', s)).toBe('rhythm-cats');
    expect(readBandName('', s)).toBe('rhythm-cats'); // remembered
  });
  it('defaults to soundcheck when never set', () => {
    expect(readBandName('', fakeStorage())).toBe(DEFAULT_BAND_NAME);
  });
  it('ignores a blank ?band=', () => {
    expect(readBandName('?band=', fakeStorage())).toBe(DEFAULT_BAND_NAME);
  });
});

describe('saveBandName', () => {
  it('persists the trimmed name', () => {
    const s = fakeStorage();
    expect(saveBandName('  The Regulars ', s)).toBe('The Regulars');
    expect(readBandName('', s)).toBe('The Regulars');
  });
  it('falls back to the default on blank input', () => {
    const s = fakeStorage();
    expect(saveBandName('   ', s)).toBe(DEFAULT_BAND_NAME);
  });
});

describe('hasSavedBandName', () => {
  it('is false on a fresh install (default name is not "configured")', () => {
    const s = fakeStorage();
    expect(hasSavedBandName(s)).toBe(false);
    // Reading the (default) name does not configure anything.
    readBandName('', s);
    expect(hasSavedBandName(s)).toBe(false);
  });

  it('is true after an explicit save, and after a ?band= link (which persists)', () => {
    const a = fakeStorage();
    saveBandName('Rhythm Cats', a);
    expect(hasSavedBandName(a)).toBe(true);

    const b = fakeStorage();
    readBandName('?band=rhythm-cats', b); // links write the key by design
    expect(hasSavedBandName(b)).toBe(true);
  });
});

describe('bandRoomCode', () => {
  it('is case- and whitespace-insensitive', () => {
    expect(bandRoomCode('Sound Check')).toBe('sound-check');
    expect(bandRoomCode('  sound   check ')).toBe('sound-check');
  });
  it('falls back to the default on blank input', () => {
    expect(bandRoomCode('  ')).toBe(DEFAULT_BAND_NAME);
  });
  it('strips URL-hostile punctuation (the code travels in WebSocket URL paths)', () => {
    expect(bandRoomCode("Kate's Band")).toBe('kates-band');
    expect(bandRoomCode('my/band?really#yes')).toBe('mybandreallyyes');
    expect(bandRoomCode('50% Tempo!')).toBe('50-tempo');
  });
  it('keeps unicode letters so non-English names still make distinct rooms', () => {
    expect(bandRoomCode('Céilí Crew')).toBe('céilí-crew');
  });
  it('falls back to the default when nothing survives stripping', () => {
    expect(bandRoomCode('!!! ***')).toBe(DEFAULT_BAND_NAME);
  });
});
