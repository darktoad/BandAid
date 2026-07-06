/**
 * The one place the app touches Web Storage. Storage access can throw at every step
 * (SSR has no localStorage; Safari private mode and full quotas throw on write; some
 * embedded webviews throw on the mere property access) — so every read degrades to
 * "absent" and every write is best-effort, and callers never carry their own try/catch.
 */
export type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** localStorage if usable, else null. */
export function safeStorage(): StorageLike | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

/** Read that never throws — errors read as "not set". */
export function readItem(storage: StorageLike | null | undefined, key: string): string | null {
  try {
    return storage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

/** Best-effort write; `null` removes the key. Never throws. */
export function writeItem(
  storage: StorageLike | null | undefined,
  key: string,
  value: string | null,
): void {
  try {
    if (value === null) storage?.removeItem(key);
    else storage?.setItem(key, value);
  } catch {
    /* best-effort */
  }
}
