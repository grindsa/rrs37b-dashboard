import { connection } from "next/server";
import { NextResponse } from "next/server";
import { withAuth } from "@/lib/with-auth";
import { getBvgDepartures } from "@/lib/bvg";

/** HAFAS stop IDs, e.g. 900130002. */
const STOP_ID_PATTERN = /^\d{6,12}$/;
const MAX_STOP_NAME_LENGTH = 80;

export const GET = withAuth(async function GET(request: Request) {
  await connection();

  const { searchParams } = new URL(request.url);
  const stopId = searchParams.get("stopId")?.trim() || undefined;
  const stopName =
    searchParams.get("name")?.trim().slice(0, MAX_STOP_NAME_LENGTH) ||
    undefined;

  if (stopId !== undefined && !STOP_ID_PATTERN.test(stopId)) {
    return NextResponse.json({ error: "invalid_stop_id" }, { status: 400 });
  }

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
