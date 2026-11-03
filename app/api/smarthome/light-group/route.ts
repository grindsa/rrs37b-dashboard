import { connection } from "next/server";
import { NextResponse } from "next/server";
import { withAuth } from "@/lib/with-auth";
import { readJsonBody } from "@/lib/request-guard";
import { throttledResponse } from "@/lib/control-throttle";
import { runLightGroupCycle } from "@/lib/smarthome";

export const POST = withAuth(async function POST(request: Request) {
  await connection();

  const parsed = await readJsonBody(request);
  if (!parsed.ok) return parsed.response;
  const { body } = parsed;

  const groupId =
    body &&
    typeof body === "object" &&
    "groupId" in body &&
    typeof (body as { groupId: unknown }).groupId === "string"
      ? (body as { groupId: string }).groupId.trim()
      : "";

  if (!groupId) {
    return NextResponse.json({ error: "Erwarte { groupId }" }, { status: 400 });
  }

  try {
    const result = await runLightGroupCycle(groupId);
    const allOk = result.results.every((r) => r.ok);
    return NextResponse.json(result, { status: allOk ? 200 : 207 });
  } catch (error) {
    const throttled = throttledResponse(error);
    if (throttled) return throttled;
    const message =
      error instanceof Error
        ? error.message
        : "Lampen-Gruppenbefehl fehlgeschlagen";
    const status = message.startsWith("Unbekannte") ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
});
