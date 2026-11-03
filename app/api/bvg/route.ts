import { connection } from "next/server";
import { NextResponse } from "next/server";
import { withAuth } from "@/lib/with-auth";
import { getBvgDepartures } from "@/lib/bvg";

export const GET = withAuth(async function GET(request: Request) {
  await connection();

  const { searchParams } = new URL(request.url);
  const stopId = searchParams.get("stopId")?.trim() || undefined;
  const stopName = searchParams.get("name")?.trim() || undefined;

  try {
    const result = await getBvgDepartures({ stopId, stopName });
    return NextResponse.json(result);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to load BVG departures";
    return NextResponse.json(
      {
        stops: [],
        fetchedAt: new Date().toISOString(),
        warnings: [message],
        candidates: [],
        mode: stopId ? "stop" : "home",
        error: message,
      },
      { status: 500 },
    );
  }
});
