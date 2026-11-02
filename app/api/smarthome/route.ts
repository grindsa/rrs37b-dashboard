import { connection } from "next/server";
import { NextResponse } from "next/server";
import { getSmarthomeSnapshot } from "@/lib/smarthome";

export async function GET() {
  await connection();

  try {
    const result = await getSmarthomeSnapshot();
    return NextResponse.json(result);
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Smarthome-Status konnte nicht geladen werden";
    return NextResponse.json(
      {
        groups: [],
        plugs: [],
        fetchedAt: new Date().toISOString(),
        anyMoving: false,
        configSource: "invalid",
        warnings: [message],
        error: message,
      },
      { status: 500 },
    );
  }
}
