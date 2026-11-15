import { NextResponse } from "next/server";
import {
  createSessionValue,
  getAccessTokens,
  isAuthConfigured,
  matchAccessToken,
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
  sessionCookieOptions,
} from "@/lib/auth";
import {
  clientIp,
  loginRetryAfterSeconds,
  recordLoginFailure,
  recordLoginSuccess,
} from "@/lib/login-rate-limit";
import { readJsonBody } from "@/lib/request-guard";

function invalidToken() {
  return NextResponse.json(
    { ok: false, error: "invalid_token" },
    { status: 401 },
  );
}

export async function POST(request: Request) {
  const ip = clientIp(request.headers);

  const parsed = await readJsonBody(request);
  if (!parsed.ok) {
    return NextResponse.json(
      { ok: false, error: "invalid_body" },
      { status: parsed.response.status },
    );
  }
  const body = parsed.body as { token?: unknown } | null;
  const token = typeof body?.token === "string" ? body.token : "";

  // No await from here on: the limit check and the failure record must not
  // interleave with parallel requests, or a burst slips past the limit.
  const retryAfter = loginRetryAfterSeconds(ip);
  if (retryAfter > 0) {
    return NextResponse.json(
      { ok: false, error: "rate_limited", retryAfter },
      { status: 429, headers: { "Retry-After": String(retryAfter) } },
    );
  }

  // Same answer as a wrong token, so the response does not reveal a misconfigured server.
  if (!isAuthConfigured()) {
    console.error(
      "[auth] login refused: AUTH_SECRET or valid ACCESS_TOKENS not configured",
    );
    return invalidToken();
  }

  const matched = matchAccessToken(token);
  if (!matched) {
    recordLoginFailure(ip);
    console.warn(`[auth] login failed ip=${JSON.stringify(ip)}`);
    return invalidToken();
  }

  recordLoginSuccess(ip);
  const tokenNumber = getAccessTokens().indexOf(matched) + 1;
  console.info(
    `[auth] login ok ip=${JSON.stringify(ip)} token=#${tokenNumber}`,
  );
  const response = NextResponse.json({ ok: true, status: "authenticated" });
  response.cookies.set(
    SESSION_COOKIE,
    createSessionValue(matched),
    sessionCookieOptions(SESSION_TTL_SECONDS),
  );
  return response;
}
