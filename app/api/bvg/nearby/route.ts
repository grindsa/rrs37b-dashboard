import { connection } from "next/server";
import { NextResponse } from "next/server";
import { withAuth } from "@/lib/with-auth";
import { getHouseCoords, getNearestStop } from "@/lib/bvg";

function roundCoord(value: number): number {
  return Math.round(value * 1000) / 1000;
}

export const GET = withAuth(async function GET(request: Request) {
  await connection();

  const { searchParams } = new URL(request.url);
  const latParam = searchParams.get("lat");
  const lonParam = searchParams.get("lon");

  // Also rounded server-side, for clients that send full precision.
  let lat = latParam != null ? roundCoord(Number(latParam)) : NaN;
  let lon = lonParam != null ? roundCoord(Number(lonParam)) : NaN;
  let source: "gps" | "home" = "gps";

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    try {
      const house = getHouseCoords();
      lat = house.lat;
      lon = house.lon;
      source = "home";
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "No coordinates for nearby lookup";
      return NextResponse.json({ error: message }, { status: 400 });
    }
  }

  try {
    const stop = await getNearestStop(lat, lon);
    return NextResponse.json({
      stop,
      source,
      fetchedAt: new Date().toISOString(),
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to find nearby stop";
    return NextResponse.json({ error: message }, { status: 500 });
  }
});
