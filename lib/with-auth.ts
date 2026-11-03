import { NextResponse } from "next/server";
import { isAuthenticated } from "./auth";

/**
 * Re-checks the session inside a route handler, so a matcher change in
 * proxy.ts cannot silently make the route public.
 */
export function withAuth<Args extends unknown[]>(
  handler: (...args: Args) => Promise<Response>,
): (...args: Args) => Promise<Response> {
  return async (...args: Args) => {
    if (!(await isAuthenticated())) {
      return NextResponse.json(
        { error: "unauthorized", status: "anonymous" },
        { status: 401 },
      );
    }
    return handler(...args);
  };
}
