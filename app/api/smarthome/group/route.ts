import { connection } from "next/server";
import { NextResponse } from "next/server";
import { isCoverAction, runGroupCoverAction } from "@/lib/smarthome";

export async function POST(request: Request) {
  await connection();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Ungültiger JSON-Body" }, { status: 400 });
  }

  const groupId =
    body &&
    typeof body === "object" &&
    "groupId" in body &&
    typeof (body as { groupId: unknown }).groupId === "string"
      ? (body as { groupId: string }).groupId.trim()
      : "";
  const action =
    body && typeof body === "object" && "action" in body
      ? (body as { action: unknown }).action
      : undefined;

  if (!groupId || !isCoverAction(action)) {
    return NextResponse.json(
      { error: "Erwarte { groupId, action: open|stop|close }" },
      { status: 400 },
    );
  }

  try {
    const result = await runGroupCoverAction(groupId, action);
    const allOk = result.results.every((r) => r.ok);
    return NextResponse.json(result, { status: allOk ? 200 : 207 });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Gruppenbefehl fehlgeschlagen";
    const status = message.startsWith("Unbekannte") ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
