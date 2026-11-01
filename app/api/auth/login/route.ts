import { NextResponse } from "next/server";
import {
  createSessionValue,
  isValidAccessToken,
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
  sessionCookieOptions,
} from "@/lib/auth";

export async function POST(request: Request) {
  let token = "";
  try {
    const body = (await request.json()) as { token?: unknown };
    if (typeof body.token === "string") token = body.token;
  } catch {
    return NextResponse.json(
      { ok: false, error: "invalid_body" },
      { status: 400 },
    );
  }

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
