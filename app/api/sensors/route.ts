import { connection } from "next/server";
import { NextResponse } from "next/server";
import { withAuth } from "@/lib/with-auth";
import { getShellySensors } from "@/lib/shelly";

export const GET = withAuth(async function GET() {
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
});
