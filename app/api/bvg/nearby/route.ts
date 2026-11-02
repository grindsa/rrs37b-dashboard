import { connection } from "next/server";
import { NextResponse } from "next/server";
import { getHouseCoords, getNearestStop } from "@/lib/bvg";

export async function GET(request: Request) {
  await connection();

  const { searchParams } = new URL(request.url);
  const latParam = searchParams.get("lat");
  const lonParam = searchParams.get("lon");

  let lat = latParam != null ? Number(latParam) : NaN;
  let lon = lonParam != null ? Number(lonParam) : NaN;
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
      lat,
      lon,
      source,
      fetchedAt: new Date().toISOString(),
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to find nearby stop";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
