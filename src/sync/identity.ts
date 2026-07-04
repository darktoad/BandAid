export interface Identity {
  authorId: string;
  name: string;
}
export type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

const KEY = 'bandaid.identity.v1';

function defaultStorage(): StorageLike | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

export function loadIdentity(
  storage: StorageLike | null = defaultStorage(),
  gen: () => string = () => crypto.randomUUID(),
): Identity {
  let id = '';
  let name = '';
  try {
    const raw = storage?.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<Identity>;
      id = parsed.authorId ?? '';
      name = parsed.name ?? '';
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

export function setDisplayName(name: string, storage: StorageLike | null = defaultStorage()): Identity {
  const current = loadIdentity(storage);
  const next = { authorId: current.authorId, name };
  save(storage, next);
  return next;
}

function save(storage: StorageLike | null, identity: Identity): void {
  try {
    storage?.setItem(KEY, JSON.stringify(identity));
  } catch {
    /* ignore */
  }
}
