import { connection } from "next/server";
import { NextResponse } from "next/server";
import { withAuth } from "@/lib/with-auth";
import { readJsonBody } from "@/lib/request-guard";
import { throttledResponse } from "@/lib/control-throttle";
import { isCoverAction, runSingleCoverAction } from "@/lib/smarthome";

export const POST = withAuth(async function POST(request: Request) {
  await connection();

  const parsed = await readJsonBody(request);
  if (!parsed.ok) return parsed.response;
  const { body } = parsed;

  const coverId =
    body &&
    typeof body === "object" &&
    "coverId" in body &&
    typeof (body as { coverId: unknown }).coverId === "string"
      ? (body as { coverId: string }).coverId.trim()
      : "";
  const action =
    body && typeof body === "object" && "action" in body
      ? (body as { action: unknown }).action
      : undefined;

  if (!coverId || !isCoverAction(action)) {
    return NextResponse.json(
      { error: "Erwarte { coverId, action: open|stop|close }" },
      { status: 400 },
    );
  }

  try {
    const result = await runSingleCoverAction(coverId, action);
    return NextResponse.json(result, {
      status: result.result.ok ? 200 : 502,
    });
  } catch (error) {
    const throttled = throttledResponse(error);
    if (throttled) return throttled;
    const message =
      error instanceof Error ? error.message : "Cover-Befehl fehlgeschlagen";
    const status = message.startsWith("Unbekanntes") ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
});
