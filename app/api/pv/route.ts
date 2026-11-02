import { connection } from "next/server";
import { NextResponse } from "next/server";
import { getPvSnapshot } from "@/lib/pv";

export async function GET() {
  await connection();

  try {
    const result = await getPvSnapshot();
    return NextResponse.json(result);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to load PV snapshot";
    return NextResponse.json(
      {
        socPct: null,
        chargeW: null,
        dischargeW: null,
        solarW: null,
        houseW: null,
        netW: null,
        fetchedAt: new Date().toISOString(),
        warnings: [message],
        error: message,
      },
      { status: 500 },
    );
  }
}
