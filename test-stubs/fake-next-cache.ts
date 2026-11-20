// A stand-in for `next/cache` in node tests: `unstable_cache` keeps JSON-serialized results by (key parts + arguments) and honors tags, `revalidateTag` marks every entry carrying
// the tag stale. It is only a model of the persisted data cache (shared by every "instance" in a test); the real one is Next's. Test-only.
type Entry = { value: string; tags: string[]; at: number };
const store = new Map<string, Entry>();
const revalidatedAt = new Map<string, number>();
let clock = 1;
export const cacheCalls = { hits: 0, misses: 0 };

export function resetFakeNextCache(): void {
  store.clear();
  revalidatedAt.clear();
  clock = 1;
  cacheCalls.hits = 0;
  cacheCalls.misses = 0;
}
/** Every cache entry's key and serialized size, for tests of the 2 MB cap. */
export const cacheEntries = (): { key: string; bytes: number }[] => [...store].map(([key, e]) => ({ key, bytes: Buffer.byteLength(e.value) }));

export function unstable_cache<A extends unknown[], R>(fn: (...args: A) => Promise<R>, keyParts: string[] = [], options: { tags?: string[]; revalidate?: number | false } = {}) {
  return async (...args: A): Promise<R> => {
    const key = JSON.stringify([keyParts, args]);
    const hit = store.get(key);
    if (hit && !hit.tags.some((t) => (revalidatedAt.get(t) ?? 0) > hit.at)) {
      cacheCalls.hits += 1;
      return JSON.parse(hit.value) as R;
    }
    cacheCalls.misses += 1;
    const value = await fn(...args);
    store.set(key, { value: JSON.stringify(value), tags: options.tags ?? [], at: (clock += 1) });
    return JSON.parse(JSON.stringify(value)) as R;
  };
}

export function revalidateTag(tag: string): void {
  clock += 1;
  revalidatedAt.set(tag, clock);
}
