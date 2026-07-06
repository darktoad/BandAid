/**
 * A subscription channel over a snapshot function: subscribers receive the current
 * value immediately on subscribe (so a late subscriber never misses state that
 * already exists) and again on every emit. The store's five notification channels,
 * provider status aggregation, and the band session all share this one shape.
 */
export interface Channel<T> {
  emit(): void;
  subscribe(run: (value: T) => void): () => void;
}

export function createChannel<T>(get: () => T): Channel<T> {
  const subs = new Set<(value: T) => void>();
  return {
    emit() {
      subs.forEach((cb) => cb(get()));
    },
    subscribe(run) {
      subs.add(run);
      run(get());
      return () => subs.delete(run);
    },
  };
}
