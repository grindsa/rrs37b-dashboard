import { NextResponse } from "next/server";
import {
  getAuthStatus,
  SESSION_COOKIE,
  sessionCookieOptions,
  verifySessionValue,
} from "@/lib/auth";
import { cookies } from "next/headers";

export async function GET() {
  const jar = await cookies();
  const raw = jar.get(SESSION_COOKIE)?.value;
  const verified = verifySessionValue(raw);
  const status = await getAuthStatus();

  const response = NextResponse.json({ ok: true, status });

  // Drop broken / expired cookies so the UI can return to an open lock.
  if (raw && !verified.ok) {
    response.cookies.set(SESSION_COOKIE, "", {
      ...sessionCookieOptions(0),
      maxAge: 0,
    });
  }

  return response;
}
