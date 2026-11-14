import { connection } from "next/server";
import { NextResponse } from "next/server";
import { withAuth } from "@/lib/with-auth";
import { getLiveSmarthomeConfig, homeSensors } from "@/lib/smarthome-config";
import { getShellySensors } from "@/lib/shelly";

export const GET = withAuth(async function GET() {
  await connection();

  try {
    const result = await getShellySensors();
    const live = getLiveSmarthomeConfig();
    const homeLabels = live.ok
      ? new Set(homeSensors(live.config).map((s) => s.label))
      : null;
    const sensors = homeLabels
      ? result.sensors.filter((s) => homeLabels.has(s.label))
      : result.sensors;
    return NextResponse.json({ ...result, sensors });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to load Shelly sensors";
    return NextResponse.json(
      {
        sensors: [],
        fetchedAt: new Date().toISOString(),
        warnings: [message],
        error: message,
      },
      { status: 500 },
    );
  }
});
