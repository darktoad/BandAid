import { describe, expect, it } from 'vitest';
import { loadCollapsed, saveCollapsed, sectionKey, NOTE_KEY } from './collapseState';
import type { LyricSection } from './chordpro';

function fakeStorage(seed: Record<string, string> = {}) {
  const m = new Map(Object.entries(seed));
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    dump: () => Object.fromEntries(m),
  };
}

const sec = (kind: LyricSection['kind'], label?: string): LyricSection => ({ kind, label, lines: [] });

describe('sectionKey', () => {
  it('identifies a section by its label, not its position', () => {
    // Position-based keys would shift every collapse state if a verse is inserted;
    // labels survive that (this is per-device state, so a miss just shows expanded).
    const sections = [sec('verse', 'Verse 1'), sec('chorus', 'Chorus')];
    const withInsert = [sec('verse', 'Intro'), ...sections];
    expect(sectionKey(sections[1], 1, sections)).toBe(sectionKey(withInsert[2], 2, withInsert));
  });

  it('distinguishes repeated labels by occurrence, so one chorus can collapse alone', () => {
    const sections = [sec('chorus', 'Chorus'), sec('verse', 'Verse 1'), sec('chorus', 'Chorus')];
    expect(sectionKey(sections[0], 0, sections)).not.toBe(sectionKey(sections[2], 2, sections));
  });

  it('falls back to position for unlabelled sections', () => {
    const sections = [sec('other'), sec('other')];
    expect(sectionKey(sections[0], 0, sections)).not.toBe(sectionKey(sections[1], 1, sections));
  });
});

describe('collapse persistence', () => {
  it('round-trips per song', () => {
    const s = fakeStorage();
    saveCollapsed('wabash', new Set(['Chorus#1', NOTE_KEY]), s);
    const back = loadCollapsed('wabash', s);
    expect(back.has('Chorus#1')).toBe(true);
    expect(back.has(NOTE_KEY)).toBe(true);
    expect(back.size).toBe(2);
  });

  it('keeps songs independent', () => {
    const s = fakeStorage();
    saveCollapsed('wabash', new Set(['Chorus#1']), s);
    expect(loadCollapsed('stones-rag', s).size).toBe(0);
  });

  it('defaults to nothing collapsed — canonical songs open everything', () => {
    expect(loadCollapsed('anything', fakeStorage()).size).toBe(0);
  });

  it('survives corrupt storage rather than throwing mid-song', () => {
    const s = fakeStorage({ 'bandaid.lyricsCollapsed.wabash': 'not json{' });
    expect(loadCollapsed('wabash', s).size).toBe(0);
  });

  it('clears the entry when nothing is collapsed (no storage litter)', () => {
    const s = fakeStorage();
    saveCollapsed('wabash', new Set(['Chorus#1']), s);
    saveCollapsed('wabash', new Set(), s);
    expect(s.dump()['bandaid.lyricsCollapsed.wabash']).toBeUndefined();
  });
});
