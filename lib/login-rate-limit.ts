/**
 * In-memory limiter for failed logins (single container, resets on restart).
 * Per client IP plus a global cap, so spreading guesses across IPs still
 * triggers a cool-down.
 */

const PER_IP_MAX_FAILURES = 5;
const PER_IP_WINDOW_MS = 15 * 60_000;
const GLOBAL_MAX_FAILURES = 60;
const GLOBAL_WINDOW_MS = 60 * 60_000;
const MAX_TRACKED_IPS = 10_000;

type Window = { failures: number; resetAt: number };

const perIp = new Map<string, Window>();
let global: Window = { failures: 0, resetAt: 0 };

function current(window: Window | undefined, now: number): Window | undefined {
  return window && window.resetAt > now ? window : undefined;
}

function sweep(now: number): void {
  for (const [ip, window] of perIp) {
    if (window.resetAt <= now) perIp.delete(ip);
  }
}

const MAX_IP_LENGTH = 64;

/**
 * Client IP as seen by the reverse proxy: the last X-Forwarded-For hop, which
 * nginx and Caddy both append themselves. X-Real-IP is only a fallback because
 * proxies that do not set it (Caddy) pass a client-supplied value through.
 */
export function clientIp(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  const last = forwarded?.split(",").at(-1)?.trim();
  const ip = last || headers.get("x-real-ip")?.trim() || "unknown";
  return ip.slice(0, MAX_IP_LENGTH);
}

/** Seconds until the caller may try again, or 0 if allowed. */
export function loginRetryAfterSeconds(ip: string, now = Date.now()): number {
  const globalWindow = current(global, now);
  const ipWindow = current(perIp.get(ip), now);
  let until = 0;
  if (globalWindow && globalWindow.failures >= GLOBAL_MAX_FAILURES) {
    until = Math.max(until, globalWindow.resetAt);
  }
  if (ipWindow && ipWindow.failures >= PER_IP_MAX_FAILURES) {
    until = Math.max(until, ipWindow.resetAt);
  }
  return until > now ? Math.ceil((until - now) / 1000) : 0;
}

export function recordLoginFailure(ip: string, now = Date.now()): void {
  if (!current(global, now)) {
    global = { failures: 0, resetAt: now + GLOBAL_WINDOW_MS };
  }
  global.failures += 1;
  if (global.failures === GLOBAL_MAX_FAILURES) {
    console.warn(
      `[auth] ${GLOBAL_MAX_FAILURES} failed logins within an hour — logins paused until ${new Date(global.resetAt).toISOString()}`,
    );
  }

  if (perIp.size >= MAX_TRACKED_IPS) sweep(now);
  const window = current(perIp.get(ip), now) ?? {
    failures: 0,
    resetAt: now + PER_IP_WINDOW_MS,
  };
  window.failures += 1;
  perIp.set(ip, window);
}

export function recordLoginSuccess(ip: string): void {
  perIp.delete(ip);
}
