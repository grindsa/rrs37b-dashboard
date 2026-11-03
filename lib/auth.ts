import { createHmac, createHash, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

// The __Host- prefix makes browsers reject this cookie name from sibling
// subdomains, but it requires Secure, which plain-HTTP dev cannot use.
export const SESSION_COOKIE =
  process.env.NODE_ENV === "production" ? "__Host-rrs37_session" : "rrs37_session";
export const MAX_ACCESS_TOKENS = 5;
/** Shorter tokens are ignored: they are guessable despite the login rate limit. */
export const MIN_ACCESS_TOKEN_LENGTH = 24;
/** Sliding session lifetime: expires after this long without use. */
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 14; // 14 days
/** Re-issue the cookie at most this often (avoids a Set-Cookie on every poll). */
export const SESSION_RENEW_AFTER_SECONDS = 60 * 60 * 24; // 1 day

export type AuthStatus = "anonymous" | "authenticated" | "invalid";

function getAuthSecret(): string | undefined {
  return process.env.AUTH_SECRET?.trim() || undefined;
}

function requireAuthSecret(): string {
  const secret = getAuthSecret();
  if (!secret) {
    throw new Error("AUTH_SECRET is not configured");
  }
  return secret;
}

/** Changing SESSION_EPOCH invalidates every session without rotating AUTH_SECRET. */
function getSessionEpoch(): string {
  return process.env.SESSION_EPOCH?.trim() || "0";
}

let loggedTokenConfig: string | undefined;

function logTokenProblems(raw: string, all: string[]): void {
  if (loggedTokenConfig === raw) return;
  loggedTokenConfig = raw;
  const short = all.filter((t) => t.length < MIN_ACCESS_TOKEN_LENGTH).length;
  if (short > 0) {
    console.error(
      `[auth] ignoring ${short} ACCESS_TOKENS shorter than ${MIN_ACCESS_TOKEN_LENGTH} characters`,
    );
  }
  if (all.length > MAX_ACCESS_TOKENS) {
    console.error(
      `[auth] ACCESS_TOKENS has ${all.length} entries; only the first ${MAX_ACCESS_TOKENS} are used`,
    );
  }
}

/** Unlock tokens from ACCESS_TOKENS (comma-separated, max 5, min 24 chars). */
export function getAccessTokens(): string[] {
  const raw = process.env.ACCESS_TOKENS?.trim() ?? "";
  if (!raw) return [];
  const all = raw
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  logTokenProblems(raw, all);
  return all
    .slice(0, MAX_ACCESS_TOKENS)
    .filter((t) => t.length >= MIN_ACCESS_TOKEN_LENGTH);
}

/** True when the server can issue sessions at all. */
export function isAuthConfigured(): boolean {
  return Boolean(getAuthSecret()) && getAccessTokens().length > 0;
}

function hashToken(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

/** Constant-time compare for variable-length secrets. */
export function safeEqualString(a: string, b: string): boolean {
  return timingSafeEqual(hashToken(a), hashToken(b));
}

/** Returns the matching configured token, or undefined. */
export function matchAccessToken(token: string): string | undefined {
  const trimmed = token.trim();
  if (!trimmed) return undefined;
  let hit: string | undefined;
  for (const candidate of getAccessTokens()) {
    if (safeEqualString(trimmed, candidate)) hit = candidate;
  }
  return hit;
}

function b64url(buf: Buffer): string {
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function fromB64url(s: string): Buffer | null {
  try {
    const padded = s.replace(/-/g, "+").replace(/_/g, "/");
    const pad = padded.length % 4 === 0 ? "" : "=".repeat(4 - (padded.length % 4));
    return Buffer.from(padded + pad, "base64");
  } catch {
    return null;
  }
}

/**
 * Opaque id of the token that unlocked a session. Keyed with AUTH_SECRET so
 * the cookie reveals nothing that could be brute-forced offline.
 */
function tokenKid(token: string, secret: string): string {
  return b64url(
    createHmac("sha256", secret).update(`kid:${token}`, "utf8").digest(),
  ).slice(0, 16);
}

function signPayload(payload: string, secret: string): string {
  return b64url(
    createHmac("sha256", secret)
      .update(`${payload}.${getSessionEpoch()}`, "utf8")
      .digest(),
  );
}

/** Signed cookie value `iat.exp.kid.sig`; never contains the token itself. */
function buildSessionValue(kid: string, secret: string, nowMs: number): string {
  const iat = Math.floor(nowMs / 1000);
  const exp = iat + SESSION_TTL_SECONDS;
  const payload = `${iat}.${exp}.${kid}`;
  return `${payload}.${signPayload(payload, secret)}`;
}

export function createSessionValue(token: string, nowMs = Date.now()): string {
  const secret = requireAuthSecret();
  return buildSessionValue(tokenKid(token, secret), secret, nowMs);
}

export type SessionVerifyResult =
  | { ok: true; iat: number; exp: number; kid: string }
  | {
      ok: false;
      reason:
        | "missing"
        | "malformed"
        | "bad_sig"
        | "expired"
        | "revoked"
        | "no_secret";
    };

export function verifySessionValue(
  value: string | undefined | null,
): SessionVerifyResult {
  if (!value) return { ok: false, reason: "missing" };

  const secret = getAuthSecret();
  if (!secret) return { ok: false, reason: "no_secret" };

  const parts = value.split(".");
  if (parts.length !== 4) return { ok: false, reason: "malformed" };

  const [iatStr, expStr, kid, sig] = parts;
  const iat = Number(iatStr);
  const exp = Number(expStr);
  if (!Number.isFinite(iat) || !Number.isFinite(exp) || !kid || !sig) {
    return { ok: false, reason: "malformed" };
  }

  const payload = `${iatStr}.${expStr}.${kid}`;
  const expected = signPayload(payload, secret);
  const sigBuf = fromB64url(sig);
  const expBuf = fromB64url(expected);
  if (!sigBuf || !expBuf || sigBuf.length !== expBuf.length) {
    return { ok: false, reason: "bad_sig" };
  }
  if (!timingSafeEqual(sigBuf, expBuf)) {
    return { ok: false, reason: "bad_sig" };
  }

  const now = Math.floor(Date.now() / 1000);
  if (now > exp) return { ok: false, reason: "expired" };

  const tokenStillValid = getAccessTokens().some(
    (token) => tokenKid(token, secret) === kid,
  );
  if (!tokenStillValid) return { ok: false, reason: "revoked" };

  return { ok: true, iat, exp, kid };
}

/** Fresh cookie value when a valid session is due for sliding renewal. */
export function renewSessionValue(
  session: Extract<SessionVerifyResult, { ok: true }>,
  nowMs = Date.now(),
): string | undefined {
  const age = Math.floor(nowMs / 1000) - session.iat;
  if (age < SESSION_RENEW_AFTER_SECONDS) return undefined;
  return buildSessionValue(session.kid, requireAuthSecret(), nowMs);
}

export function sessionCookieOptions(maxAgeSeconds: number) {
  const secure = process.env.NODE_ENV === "production";
  return {
    httpOnly: true,
    secure,
    sameSite: "lax" as const,
    path: "/",
    maxAge: maxAgeSeconds,
  };
}

/** Read session from the request cookie store (Server Components / Route Handlers). */
export async function getAuthStatus(): Promise<AuthStatus> {
  const jar = await cookies();
  const raw = jar.get(SESSION_COOKIE)?.value;
  if (!raw) return "anonymous";
  const result = verifySessionValue(raw);
  if (result.ok) return "authenticated";
  return "invalid";
}

export async function isAuthenticated(): Promise<boolean> {
  return (await getAuthStatus()) === "authenticated";
}
