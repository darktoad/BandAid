import { routePartykitRequest } from 'partyserver';
import { YServer } from 'y-partyserver';
import * as Y from 'yjs';

const STORAGE_KEY = 'doc';

// One Durable Object instance per room (= band code); YServer speaks the Yjs sync
// protocol and keeps the doc. Binding name `Corrections` → client party `corrections`.
//
// PartyServer/y-partyserver only keep the doc in memory by default — it can be lost
// once the room empties and the Durable Object is evicted. We persist the Yjs update
// to the Durable Object's own storage (this.ctx.storage) so a room's corrections
// survive across restarts/evictions.
export class Corrections extends YServer {
  async onLoad() {
    const saved = await this.ctx.storage.get<Uint8Array>(STORAGE_KEY);
    if (saved) {
      Y.applyUpdate(this.document, saved);
    }
  }

  async onSave() {
    const update = Y.encodeStateAsUpdate(this.document);
    await this.ctx.storage.put(STORAGE_KEY, update);
  }
}

export default {
  async fetch(request: Request, env: unknown): Promise<Response> {
    return (
      (await routePartykitRequest(request, env as Record<string, unknown>)) ??
      new Response('Not Found', { status: 404 })
    );
  }
};
