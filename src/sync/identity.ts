import { readItem, writeItem, safeStorage, type StorageLike } from './storage';

export interface Identity {
  authorId: string;
  name: string;
}
export type { StorageLike };

const KEY = 'bandaid.identity.v1';

export function loadIdentity(
  storage: StorageLike | null = safeStorage(),
  gen: () => string = () => crypto.randomUUID(),
): Identity {
  let id = '';
  let name = '';
  try {
    const raw = readItem(storage, KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<Identity>;
      id = typeof parsed.authorId === 'string' ? parsed.authorId : '';
      name = typeof parsed.name === 'string' ? parsed.name : '';
    }
  } catch {
    /* ignore corrupt value */
  }
  if (!id) {
    id = gen();
    save(storage, { authorId: id, name });
  }
  return { authorId: id, name };
}

export function setDisplayName(name: string, storage: StorageLike | null = safeStorage()): Identity {
  const next = { authorId: loadIdentity(storage).authorId, name };
  save(storage, next);
  return next;
}

function save(storage: StorageLike | null, identity: Identity): void {
  writeItem(storage, KEY, JSON.stringify(identity));
}
