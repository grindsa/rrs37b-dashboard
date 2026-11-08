import { connection } from "next/server";
import { NextResponse } from "next/server";
import { withAuth } from "@/lib/with-auth";
import { getHeatingSnapshot } from "@/lib/heating";

export const GET = withAuth(async function GET() {
  await connection();

  try {
    const result = await getHeatingSnapshot();
    return NextResponse.json(result, {
      status: result.error ? 502 : 200,
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Failed to load heating snapshot";
    return NextResponse.json(
      {
        groups: [],
        fetchedAt: new Date().toISOString(),
        configured: false,
        warnings: [],
        error: message,
      },
      { status: 500 },
    );
  }
});
