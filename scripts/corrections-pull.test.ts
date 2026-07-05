import { describe, it, expect } from 'vitest';
import { buildInbox } from './corrections-pull';
import { createBandDoc, putCorrection } from '../src/sync/doc';
import { makeCorrection } from '../src/sync/corrections';

describe('buildInbox', () => {
  it('serializes open corrections from a doc and stamps generatedAt', () => {
    const doc = createBandDoc();
    putCorrection(
      doc,
      makeCorrection(
        { songId: 's', anchor: { kind: 'point', bar: 4, beat: 1 }, text: 'tie', author: 'A', authorId: 'd', songVersion: 'v1' },
        { id: 'c1', now: 1 },
      ),
    );
    const inbox = buildInbox(doc, 'v2', 5000);
    expect(inbox.generatedAt).toBe(5000);
    expect(inbox.songs.s[0].id).toBe('c1');
    expect(inbox.songs.s[0].stale).toBe(true);
  });
});
