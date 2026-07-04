import { writeFileSync, mkdirSync } from 'node:fs';
import * as Y from 'yjs';
import { listCorrections } from '../src/sync/doc';
import { serializeInbox } from '../src/sync/corrections';
import type { InboxFile } from '../src/sync/types';

/** Pure: doc → inbox JSON. `now`/version injected so it's testable offline. */
export function buildInbox(doc: Y.Doc, currentSongVersion: string, now: number): InboxFile {
  return { ...serializeInbox(listCorrections(doc), currentSongVersion), generatedAt: now };
}

async function main() {
  const bandCode = process.argv[2];
  if (!bandCode) throw new Error('usage: corrections:pull -- <bandCode>');
  const host = process.env.VITE_SYNC_HOST;
  if (!host) throw new Error('set VITE_SYNC_HOST to the deployed worker host');

  const { default: YProvider } = await import('y-partyserver/provider');
  const doc = new Y.Doc();
  const provider = new YProvider(host, bandCode, doc, { party: 'corrections', connect: true });
  await new Promise<void>((resolve) => provider.once('synced', () => resolve()));

  const songVersion = process.env.BUILD_ID ?? 'unknown';
  const inbox = buildInbox(doc, songVersion, Date.now());
  mkdirSync('corrections', { recursive: true });
  writeFileSync('corrections/inbox.json', JSON.stringify(inbox, null, 2) + '\n');
  console.log(`Wrote corrections/inbox.json (${Object.keys(inbox.songs).length} song(s))`);
  provider.disconnect();
}

// Only run when invoked directly, not when imported by the test.
if (process.argv[1]?.endsWith('corrections-pull.ts')) {
  main().then(() => process.exit(0)).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
