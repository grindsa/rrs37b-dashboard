import { connection } from "next/server";
import { NextResponse } from "next/server";
import { withAuth } from "@/lib/with-auth";
import { readJsonBody } from "@/lib/request-guard";
import { throttledResponse } from "@/lib/control-throttle";
import { runPlugVolumeNudge } from "@/lib/smarthome";

export const POST = withAuth(async function POST(request: Request) {
  await connection();

  const parsed = await readJsonBody(request);
  if (!parsed.ok) return parsed.response;
  const { body } = parsed;

  const plugId =
    body &&
    typeof body === "object" &&
    "plugId" in body &&
    typeof (body as { plugId: unknown }).plugId === "string"
      ? (body as { plugId: string }).plugId.trim()
      : "";
  const deltaRaw =
    body && typeof body === "object" && "delta" in body
      ? (body as { delta: unknown }).delta
      : undefined;
  const delta =
    deltaRaw === 1 || deltaRaw === -1 ? (deltaRaw as 1 | -1) : undefined;

  if (!plugId || delta === undefined) {
    return NextResponse.json(
      { error: "Erwarte { plugId, delta: 1 | -1 }" },
      { status: 400 },
    );
  }

  try {
    const result = await runPlugVolumeNudge(plugId, delta);
    return NextResponse.json(result, {
      status: result.result.ok ? 200 : 502,
    });
  } catch (error) {
    const throttled = throttledResponse(error);
    if (throttled) return throttled;
    const message =
      error instanceof Error
        ? error.message
        : "Lautstärke-Befehl fehlgeschlagen";
    const status = message.startsWith("Unbekannter") ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
});
