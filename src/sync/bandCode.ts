import type { StorageLike } from './identity';

const KEY = 'bandaid.band.v1';

export function readBandCode(
  search: string,
  storage: StorageLike | null = safeLocal(),
): string | null {
  const fromUrl = new URLSearchParams(search).get('band');
  if (fromUrl) {
    try {
      storage?.setItem(KEY, fromUrl);
    } catch {
      /* ignore */
    }
    return fromUrl;
  }
  try {
    return storage?.getItem(KEY) ?? null;
  } catch {
    return null;
  }
}

function safeLocal(): StorageLike | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}
