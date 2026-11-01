import { connection } from "next/server";
import { NextResponse } from "next/server";
import { getShellySensors } from "@/lib/shelly";

export async function GET() {
  await connection();

  try {
    const result = await getShellySensors();
    return NextResponse.json(result);
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
}
