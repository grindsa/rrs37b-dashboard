/**
 * Global per-device limit for motor/relay commands (protects shutter motors
 * and relays against a leaked session). In-memory, per Node process.
 */

const MIN_SPACING_MS = 1_000;
const WINDOW_MS = 10 * 60_000;
const MAX_PER_WINDOW = 30;

const history = new Map<string, number[]>();

export class ControlThrottledError extends Error {
  constructor(readonly retryAfterSeconds: number) {
    super(
      `Zu viele Befehle — bitte in ${retryAfterSeconds} s erneut versuchen`,
    );
    this.name = "ControlThrottledError";
  }
}

export function throttledResponse(error: unknown): Response | undefined {
  if (!(error instanceof ControlThrottledError)) return undefined;
  return Response.json(
    { error: error.message },
    {
      status: 429,
      headers: { "Retry-After": String(error.retryAfterSeconds) },
    },
  );
}

function recent(key: string, now: number): number[] {
  const kept = (history.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  if (kept.length === 0) history.delete(key);
  else history.set(key, kept);
  return kept;
}

/**
 * Checks all device keys first and records only if every key is allowed, so a
 * group command either reaches all covers or none.
 */
export function takeControlSlot(keys: string[]): void {
  const now = Date.now();
  let waitMs = 0;

  for (const key of keys) {
    const times = recent(key, now);
    const last = times.at(-1);
    if (last !== undefined && now - last < MIN_SPACING_MS) {
      waitMs = Math.max(waitMs, MIN_SPACING_MS - (now - last));
    }
    if (times.length >= MAX_PER_WINDOW) {
      waitMs = Math.max(waitMs, WINDOW_MS - (now - times[0]));
    }
  }

  if (waitMs > 0) {
    throw new ControlThrottledError(Math.max(1, Math.ceil(waitMs / 1000)));
  }

  for (const key of keys) {
    history.set(key, [...(history.get(key) ?? []), now]);
  }
}
