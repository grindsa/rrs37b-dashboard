import { connection } from "next/server";
import { NextResponse } from "next/server";
import { readJsonBody } from "@/lib/request-guard";
import { runPlugSet } from "@/lib/smarthome";

export async function POST(request: Request) {
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
  const on =
    body && typeof body === "object" && "on" in body
      ? (body as { on: unknown }).on
      : undefined;

  if (!plugId || typeof on !== "boolean") {
    return NextResponse.json(
      { error: "Erwarte { plugId, on: boolean }" },
      { status: 400 },
    );
  }

  try {
    const result = await runPlugSet(plugId, on);
    return NextResponse.json(result, {
      status: result.result.ok ? 200 : 502,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Plug-Befehl fehlgeschlagen";
    const status = message.startsWith("Unbekannter") ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
