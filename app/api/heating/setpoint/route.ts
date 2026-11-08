import { connection } from "next/server";
import { NextResponse } from "next/server";
import { withAuth } from "@/lib/with-auth";
import { readJsonBody } from "@/lib/request-guard";
import { throttledResponse } from "@/lib/control-throttle";
import { runSetpoint } from "@/lib/heating";

export const POST = withAuth(async function POST(request: Request) {
  await connection();

  const parsed = await readJsonBody(request);
  if (!parsed.ok) return parsed.response;
  const { body } = parsed;

  const id =
    body &&
    typeof body === "object" &&
    "id" in body &&
    typeof (body as { id: unknown }).id === "string"
      ? (body as { id: string }).id.trim()
      : "";
  const celsiusRaw =
    body && typeof body === "object" && "celsius" in body
      ? (body as { celsius: unknown }).celsius
      : undefined;
  const celsius =
    typeof celsiusRaw === "number"
      ? celsiusRaw
      : typeof celsiusRaw === "string"
        ? Number(celsiusRaw)
        : NaN;

  if (!id || !Number.isFinite(celsius)) {
    return NextResponse.json(
      { error: "Erwarte { id, celsius }", code: "bad_request" },
      { status: 400 },
    );
  }

  try {
    const result = await runSetpoint(id, celsius);
    return NextResponse.json(result, {
      status: result.ok ? 200 : result.code === "not_found" ? 404 : 502,
    });
  } catch (error) {
    const throttled = throttledResponse(error);
    if (throttled) return throttled;
    const message =
      error instanceof Error
        ? error.message
        : "Sollwert setzen fehlgeschlagen";
    return NextResponse.json(
      { ok: false, error: message, code: "unknown" },
      { status: 500 },
    );
  }
});
