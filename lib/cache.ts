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
  if (Date.now() > entry.expiresAt) {
    store.delete(key);
    return undefined;
  }
  return entry.value as T;
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

export async function cacheGetOrSet<T>(
  key: string,
  ttlMs: number,
  loader: () => Promise<T>,
): Promise<T> {
  const hit = cacheGet<T>(key);
  if (hit !== undefined) return hit;
  const value = await loader();
  cacheSet(key, value, ttlMs);
  return value;
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
