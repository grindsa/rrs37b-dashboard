/**
 * Simple in-process TTL cache (MVP — no Redis).
 * Survives only for the lifetime of the Node process.
 */

type CacheEntry<T> = {
  value: T;
  expiresAt: number;
};

const store = new Map<string, CacheEntry<unknown>>();

/** Bounds memory even if callers produce many distinct keys. */
const MAX_ENTRIES = 500;
const SWEEP_INTERVAL_MS = 60_000;
let lastSweep = 0;

function sweep(now: number): void {
  lastSweep = now;
  for (const [key, entry] of store) {
    if (now > entry.expiresAt) store.delete(key);
  }
  // Map iterates in insertion order, so this drops the oldest entries first.
  for (const key of store.keys()) {
    if (store.size <= MAX_ENTRIES) break;
    store.delete(key);
  }
}

export function cacheGet<T>(key: string): T | undefined {
  const entry = store.get(key);
  if (!entry) return undefined;
  // Expired entries stay until sweep so cacheGetStale can serve them.
  if (Date.now() > entry.expiresAt) return undefined;
  return entry.value as T;
}

/**
 * Return a cached value even if TTL expired (for stale-while-revalidate).
 * Does not delete the entry.
 */
export function cacheGetStale<T>(key: string): T | undefined {
  const entry = store.get(key);
  if (!entry) return undefined;
  return entry.value as T;
}

/** True when a live (non-expired) entry exists. */
export function cacheHasFresh(key: string): boolean {
  return cacheGet(key) !== undefined;
}

export function cacheSet<T>(key: string, value: T, ttlMs: number): void {
  const now = Date.now();
  store.delete(key);
  store.set(key, { value, expiresAt: now + ttlMs });
  if (store.size > MAX_ENTRIES || now - lastSweep > SWEEP_INTERVAL_MS) {
    sweep(now);
  }
}

export function cacheDelete(key: string): void {
  store.delete(key);
}

/** Concurrent misses share one load, so devices see a single round. */
const inflight = new Map<string, Promise<unknown>>();

export async function cacheGetOrSet<T>(
  key: string,
  ttlMs: number,
  loader: () => Promise<T>,
): Promise<T> {
  const hit = cacheGet<T>(key);
  if (hit !== undefined) return hit;

  const pending = inflight.get(key);
  if (pending) return pending as Promise<T>;

  const load = (async () => {
    try {
      const value = await loader();
      cacheSet(key, value, ttlMs);
      return value;
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, load);
  return load;
}

/** Suggested TTLs from the handover (ms). */
export const CACHE_TTL = {
  shelly: 45_000,
  bvg: 45_000,
  weather: 12 * 60_000,
  pv: 30_000,
  /** Cover/plug status; control POSTs always bypass / invalidate. */
  smarthome: 8_000,
} as const;
