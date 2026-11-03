/**
 * APsystems EZ1-M Local API — solar production (p1 + p2, W).
 * Requires Local Mode enabled continuously in AP EasyPower.
 */

const DEFAULT_PORT = 8050;
const TIMEOUT_MS = 8_000;

export type Ez1Reading = {
  solarW: number;
};

type Ez1OutputData = {
  data?: {
    p1?: number | string;
    p2?: number | string;
  };
  message?: string;
};

function envHost(): string | null {
  const v = process.env.APSYSTEMS_EZ1_HOST?.trim();
  return v || null;
}

function envPort(): number {
  const raw = process.env.APSYSTEMS_EZ1_PORT?.trim();
  if (!raw) return DEFAULT_PORT;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 && n < 65536 ? n : DEFAULT_PORT;
}

function asFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export async function fetchEz1Production(): Promise<Ez1Reading | null> {
  const host = envHost();
  if (!host) return null;

  const port = envPort();
  const url = `http://${host}:${port}/getOutputData`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      cache: "no-store",
      redirect: "error",
    });

    if (!response.ok) {
      throw new Error(
        `APsystems EZ1-M HTTP ${response.status} — Local API aktiviert?`,
      );
    }

    const payload = (await response.json()) as Ez1OutputData;
    if (payload.message && payload.message !== "SUCCESS") {
      throw new Error(
        `APsystems EZ1-M: ${payload.message} — Local API prüfen`,
      );
    }

    const p1 = asFiniteNumber(payload.data?.p1) ?? 0;
    const p2 = asFiniteNumber(payload.data?.p2) ?? 0;

    if (
      asFiniteNumber(payload.data?.p1) === null &&
      asFiniteNumber(payload.data?.p2) === null
    ) {
      throw new Error("APsystems EZ1-M: getOutputData ohne p1/p2");
    }

    return { solarW: p1 + p2 };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(
        "APsystems EZ1-M Timeout — Local API offline?",
      );
    }
    if (error instanceof TypeError) {
      throw new Error(
        "APsystems EZ1-M nicht erreichbar — Local Mode „Continuously“?",
      );
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
