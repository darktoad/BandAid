import * as Y from 'yjs';
import { setCorrectionStatus } from '../src/sync/doc';

async function main() {
  const ids = process.argv.slice(2);
  if (ids.length === 0) throw new Error('usage: corrections:resolve -- <id> [id...]');
  const bandCode = process.env.BAND_CODE;
  const host = process.env.VITE_SYNC_HOST;
  if (!bandCode || !host) throw new Error('set BAND_CODE and VITE_SYNC_HOST');

  const { default: YProvider } = await import('y-partyserver/provider');
  const doc = new Y.Doc();
  const provider = new YProvider(host, bandCode, doc, { party: 'corrections', connect: true });
  await new Promise<void>((resolve) => provider.once('synced', () => resolve()));

  for (const id of ids) setCorrectionStatus(doc, id, 'applied');
  // Give the provider a tick to flush the update to the server before exiting.
  await new Promise((r) => setTimeout(r, 500));
  console.log(`Marked ${ids.length} correction(s) applied`);
  provider.disconnect();
}

main().then(() => process.exit(0)).catch((e) => {
  console.error(e);
  process.exit(1);
});
