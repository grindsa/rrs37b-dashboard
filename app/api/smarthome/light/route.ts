import { connection } from "next/server";
import { NextResponse } from "next/server";
import { withAuth } from "@/lib/with-auth";
import { readJsonBody } from "@/lib/request-guard";
import { throttledResponse } from "@/lib/control-throttle";
import { runLampCycle } from "@/lib/smarthome";

export const POST = withAuth(async function POST(request: Request) {
  await connection();

  const parsed = await readJsonBody(request);
  if (!parsed.ok) return parsed.response;
  const { body } = parsed;

  const lampId =
    body &&
    typeof body === "object" &&
    "lampId" in body &&
    typeof (body as { lampId: unknown }).lampId === "string"
      ? (body as { lampId: string }).lampId.trim()
      : "";

  if (!lampId) {
    return NextResponse.json({ error: "Erwarte { lampId }" }, { status: 400 });
  }

  try {
    const result = await runLampCycle(lampId);
    return NextResponse.json(result, {
      status: result.result.ok ? 200 : 502,
    });
  } catch (error) {
    const throttled = throttledResponse(error);
    if (throttled) return throttled;
    const message =
      error instanceof Error ? error.message : "Lampenbefehl fehlgeschlagen";
    const status = message.startsWith("Unbekannte") ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
});
