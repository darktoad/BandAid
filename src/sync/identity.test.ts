import { describe, it, expect } from 'vitest';
import { loadIdentity, setDisplayName } from './identity';

function fakeStorage() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
}

describe('identity', () => {
  it('mints a stable authorId once and persists it', () => {
    const s = fakeStorage();
    let n = 0;
    const a = loadIdentity(s, () => `id-${++n}`);
    const b = loadIdentity(s, () => `id-${++n}`);
    expect(a.authorId).toBe('id-1');
    expect(b.authorId).toBe('id-1'); // reused, not regenerated
    expect(a.name).toBe('');
  });

  it('edits the display name but keeps the id', () => {
    const s = fakeStorage();
    const a = loadIdentity(s, () => 'id-1');
    const b = setDisplayName('Fiddle', s);
    expect(b).toEqual({ authorId: 'id-1', name: 'Fiddle' });
    expect(loadIdentity(s, () => 'id-2').name).toBe('Fiddle');
  });
});
