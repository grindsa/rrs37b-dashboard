import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  SESSION_COOKIE,
  sessionCookieOptions,
  verifySessionValue,
} from "@/lib/auth";

/**
 * Next.js 16: `middleware` was renamed to `proxy`.
 * Gates pages + /api/* behind a signed session cookie.
 * Auth endpoints stay public so the header lock modal can unlock.
 */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const isAuthApi =
    pathname === "/api/auth/login" ||
    pathname === "/api/auth/logout" ||
    pathname === "/api/auth/status";

  if (isAuthApi) {
    return NextResponse.next();
  }

  const raw = request.cookies.get(SESSION_COOKIE)?.value;
  const session = verifySessionValue(raw);
  const authenticated = session.ok;

  // Clear broken cookies early.
  const clearBadCookie = (response: NextResponse) => {
    if (raw && !session.ok) {
      response.cookies.set(SESSION_COOKIE, "", {
        ...sessionCookieOptions(0),
        maxAge: 0,
      });
    }
    return response;
  };

  if (pathname.startsWith("/api/")) {
    if (!authenticated) {
      return clearBadCookie(
        NextResponse.json(
          { error: "unauthorized", status: "anonymous" },
          { status: 401 },
        ),
      );
    }
    return NextResponse.next();
  }

  // HTML pages: always reach the app shell (lock icon UX), but mark auth
  // for downstream and refuse to leave a bad cookie around.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(
    "x-rrs37-auth",
    authenticated ? "authenticated" : "anonymous",
  );

  const response = NextResponse.next({
    request: { headers: requestHeaders },
  });
  return clearBadCookie(response);
}

export const config = {
  matcher: [
    /*
     * Match all paths except static assets / Next internals / common icons.
     */
    "/((?!_next/static|_next/image|favicon.ico|icon.png|apple-icon.png|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
