import { connection } from "next/server";
import { NextResponse } from "next/server";
import { withAuth } from "@/lib/with-auth";
import {
  getPvHouseSnapshot,
  getPvRestSnapshot,
  getPvSnapshot,
} from "@/lib/pv";

export const GET = withAuth(async function GET(request: Request) {
  await connection();

  const part = new URL(request.url).searchParams.get("part")?.trim();

  try {
    if (part === "house") {
      return NextResponse.json(await getPvHouseSnapshot());
    }
    if (part === "rest") {
      return NextResponse.json(await getPvRestSnapshot());
    }
    return NextResponse.json(await getPvSnapshot());
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to load PV snapshot";
    const empty =
      part === "house"
        ? {
            houseW: null,
            fetchedAt: new Date().toISOString(),
            warnings: [message],
            error: message,
          }
        : part === "rest"
          ? {
              socPct: null,
              chargeW: null,
              dischargeW: null,
              noahSolarW: null,
              workMode: null,
              solarW: null,
              fetchedAt: new Date().toISOString(),
              warnings: [message],
              error: message,
            }
          : {
              socPct: null,
              chargeW: null,
              dischargeW: null,
              noahSolarW: null,
              workMode: null,
              solarW: null,
              houseW: null,
              netW: null,
              fetchedAt: new Date().toISOString(),
              warnings: [message],
              error: message,
            };
    return NextResponse.json(empty, { status: 500 });
  }
});
