import { connection } from "next/server";
import { NextResponse } from "next/server";
import { getBvgDepartures } from "@/lib/bvg";

export async function GET() {
  await connection();

  try {
    const result = await getBvgDepartures();
    return NextResponse.json(result);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to load BVG departures";
    return NextResponse.json(
      {
        stops: [],
        fetchedAt: new Date().toISOString(),
        warnings: [message],
        error: message,
      },
      { status: 500 },
    );
  }
}
