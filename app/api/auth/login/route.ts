import { NextResponse } from "next/server";
import {
  createSessionValue,
  isValidAccessToken,
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
  sessionCookieOptions,
} from "@/lib/auth";
import { readJsonBody } from "@/lib/request-guard";

export async function POST(request: Request) {
  const parsed = await readJsonBody(request);
  if (!parsed.ok) {
    return NextResponse.json(
      { ok: false, error: "invalid_body" },
      { status: parsed.response.status },
    );
  }
  const body = parsed.body as { token?: unknown } | null;
  const token = typeof body?.token === "string" ? body.token : "";

  if (!process.env.AUTH_SECRET?.trim()) {
    return NextResponse.json(
      { ok: false, error: "auth_not_configured" },
      { status: 503 },
    );
  }

  if (!isValidAccessToken(token)) {
    return NextResponse.json(
      { ok: false, error: "invalid_token" },
      { status: 401 },
    );
  }

  const value = createSessionValue();
  const response = NextResponse.json({ ok: true, status: "authenticated" });
  response.cookies.set(
    SESSION_COOKIE,
    value,
    sessionCookieOptions(SESSION_TTL_SECONDS),
  );
  return response;
}
