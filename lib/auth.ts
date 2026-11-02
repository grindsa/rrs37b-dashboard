import { createHmac, createHash, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

// The __Host- prefix makes browsers reject this cookie name from sibling
// subdomains, but it requires Secure, which plain-HTTP dev cannot use.
export const SESSION_COOKIE =
  process.env.NODE_ENV === "production" ? "__Host-rrs37_session" : "rrs37_session";
export const MAX_ACCESS_TOKENS = 5;
/** Session lifetime after a successful token unlock. */
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

export type AuthStatus = "anonymous" | "authenticated" | "invalid";

function requireAuthSecret(): string {
  const secret = process.env.AUTH_SECRET?.trim();
  if (!secret) {
    throw new Error("AUTH_SECRET is not configured");
  }
  return secret;
}

/** Shared unlock tokens from ACCESS_TOKENS (comma-separated, max 5). */
export function getAccessTokens(): string[] {
  const raw = process.env.ACCESS_TOKENS?.trim() ?? "";
  if (!raw) return [];
  return raw
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, MAX_ACCESS_TOKENS);
}

function hashToken(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

/** Constant-time compare for variable-length secrets. */
export function safeEqualString(a: string, b: string): boolean {
  return timingSafeEqual(hashToken(a), hashToken(b));
}

export function isValidAccessToken(token: string): boolean {
  const trimmed = token.trim();
  if (!trimmed) return false;
  const tokens = getAccessTokens();
  for (const candidate of tokens) {
    if (safeEqualString(trimmed, candidate)) return true;
  }
  return false;
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

function signPayload(payload: string, secret: string): string {
  return b64url(createHmac("sha256", secret).update(payload, "utf8").digest());
}

/** Create a signed session cookie value (does not embed the access token). */
export function createSessionValue(nowMs = Date.now()): string {
  const secret = requireAuthSecret();
  const iat = Math.floor(nowMs / 1000);
  const exp = iat + SESSION_TTL_SECONDS;
  const payload = `${iat}.${exp}`;
  return `${payload}.${signPayload(payload, secret)}`;
}

export type SessionVerifyResult =
  | { ok: true; exp: number }
  | { ok: false; reason: "missing" | "malformed" | "bad_sig" | "expired" | "no_secret" };

export function verifySessionValue(
  value: string | undefined | null,
): SessionVerifyResult {
  if (!value) return { ok: false, reason: "missing" };

  const secret = process.env.AUTH_SECRET?.trim();
  if (!secret) return { ok: false, reason: "no_secret" };

  const parts = value.split(".");
  if (parts.length !== 3) return { ok: false, reason: "malformed" };

  const [iatStr, expStr, sig] = parts;
  const iat = Number(iatStr);
  const exp = Number(expStr);
  if (!Number.isFinite(iat) || !Number.isFinite(exp) || !sig) {
    return { ok: false, reason: "malformed" };
  }

  const payload = `${iatStr}.${expStr}`;
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

  return { ok: true, exp };
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
