import { connection } from "next/server";
import { NextResponse } from "next/server";
import { getWeather } from "@/lib/weather";

export async function GET() {
  await connection();

  try {
    const weather = await getWeather();
    return NextResponse.json(weather);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to load weather";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
