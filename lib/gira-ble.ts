/**
 * Server-side client for gira-ble-api (Gira System 3000 thermostats + covers).
 * Call only from Route Handlers / server code — the proxy has no CORS.
 */

import { clampSetpointC } from "@/lib/heating-setpoint";

export {
  SETPOINT_MIN_C,
  SETPOINT_MAX_C,
  SETPOINT_STEP_C,
  clampSetpointC,
} from "@/lib/heating-setpoint";

/** BLE list/ads are short; GATT writes can take tens of seconds. */
const LIST_TIMEOUT_MS = 8_000;
const COMMAND_TIMEOUT_MS = 75_000;

export type GiraThermostat = {
  id: string;
  name: string;
  mac: string | null;
  online: boolean;
  paired: boolean | null;
  temperature_c: number | null;
  setpoint_c: number | null;
  updated_at: string | null;
  last_seen_at: string | null;
  rssi: number | null;
  error: string | null;
};

export type GiraCover = {
  id: string;
  name: string;
  mac: string | null;
  online: boolean;
  paired: boolean | null;
  /** 0 = closed, 100 = open (Home Assistant cover convention). */
  position_pct: number | null;
  updated_at: string | null;
  last_seen_at: string | null;
  rssi: number | null;
  error: string | null;
};

export type GiraCoverAction = "up" | "down" | "stop";

export type GiraBleApiError = {
  error: string;
  code: string;
};

export class GiraBleError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "GiraBleError";
  }
}

function baseUrl(): string | null {
  const raw = process.env.GIRA_BLE_API_URL?.trim();
  if (!raw) return null;
  return raw.replace(/\/+$/, "");
}

function authHeaders(): HeadersInit {
  const token = process.env.GIRA_BLE_API_TOKEN?.trim();
  const headers: Record<string, string> = {
    Accept: "application/json",
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

export function isGiraBleConfigured(): boolean {
  return Boolean(baseUrl());
}

function parseDetail(body: unknown): GiraBleApiError | null {
  if (!body || typeof body !== "object") return null;
  const detail = (body as { detail?: unknown }).detail;
  if (!detail || typeof detail !== "object") return null;
  const error =
    "error" in detail && typeof (detail as { error: unknown }).error === "string"
      ? (detail as { error: string }).error
      : null;
  const code =
    "code" in detail && typeof (detail as { code: unknown }).code === "string"
      ? (detail as { code: string }).code
      : null;
  if (!error && !code) return null;
  return { error: error ?? "Fehler", code: code ?? "unknown" };
}

async function readJson(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function asNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function asNullableString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") return null;
  const t = value.trim();
  return t || null;
}

function asNullableBool(value: unknown): boolean | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "boolean") return value;
  return null;
}

function normalizeThermostat(raw: unknown): GiraThermostat | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const id = asNullableString(o.id);
  if (!id) return null;
  return {
    id,
    name: asNullableString(o.name) ?? id,
    mac: asNullableString(o.mac),
    online: o.online === true,
    paired: asNullableBool(o.paired),
    temperature_c: asNullableNumber(o.temperature_c),
    setpoint_c: asNullableNumber(o.setpoint_c),
    updated_at: asNullableString(o.updated_at),
    last_seen_at: asNullableString(o.last_seen_at),
    rssi: asNullableNumber(o.rssi),
    error: asNullableString(o.error),
  };
}

function normalizeCover(raw: unknown): GiraCover | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const id = asNullableString(o.id);
  if (!id) return null;
  const positionRaw = asNullableNumber(o.position_pct);
  const position_pct =
    positionRaw === null
      ? null
      : Math.max(0, Math.min(100, Math.round(positionRaw)));
  return {
    id,
    name: asNullableString(o.name) ?? id,
    mac: asNullableString(o.mac),
    online: o.online === true,
    paired: asNullableBool(o.paired),
    position_pct,
    updated_at: asNullableString(o.updated_at),
    last_seen_at: asNullableString(o.last_seen_at),
    rssi: asNullableNumber(o.rssi),
    error: asNullableString(o.error),
  };
}

async function giraFetch(
  path: string,
  init: RequestInit & { timeoutMs: number },
): Promise<Response> {
  const root = baseUrl();
  if (!root) {
    throw new GiraBleError(
      "GIRA_BLE_API_URL ist nicht gesetzt",
      "not_configured",
      503,
    );
  }

  const { timeoutMs, ...rest } = init;
  try {
    return await fetch(`${root}${path}`, {
      ...rest,
      headers: {
        ...authHeaders(),
        ...(rest.headers ?? {}),
      },
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    const aborted =
      error instanceof DOMException && error.name === "TimeoutError";
    throw new GiraBleError(
      aborted
        ? "Gira-Proxy Timeout"
        : error instanceof Error
          ? error.message
          : "Gira-Proxy nicht erreichbar",
      aborted ? "timeout" : "unreachable",
      502,
    );
  }
}

async function throwIfNotOk(res: Response): Promise<void> {
  if (res.ok) return;
  const body = await readJson(res);
  const detail = parseDetail(body);
  throw new GiraBleError(
    detail?.error ?? `Gira-Proxy HTTP ${res.status}`,
    detail?.code ?? (res.status === 401 ? "unauthorized" : "http_error"),
    res.status,
  );
}

function asDeviceList(
  body: unknown,
  wrappedKey: "thermostats" | "covers",
): unknown[] | null {
  if (Array.isArray(body)) return body;
  if (
    body &&
    typeof body === "object" &&
    Array.isArray((body as Record<string, unknown>)[wrappedKey])
  ) {
    return (body as Record<string, unknown[]>)[wrappedKey];
  }
  return null;
}

export async function giraBleHealth(): Promise<{ ok: boolean }> {
  const res = await giraFetch("/health", {
    method: "GET",
    timeoutMs: LIST_TIMEOUT_MS,
  });
  await throwIfNotOk(res);
  const body = await readJson(res);
  const ok =
    body &&
    typeof body === "object" &&
    (body as { ok?: unknown }).ok === true;
  return { ok: Boolean(ok) };
}

export async function listGiraThermostats(): Promise<GiraThermostat[]> {
  const res = await giraFetch("/thermostats", {
    method: "GET",
    timeoutMs: LIST_TIMEOUT_MS,
  });
  await throwIfNotOk(res);
  const body = await readJson(res);
  const list = asDeviceList(body, "thermostats");
  if (!list) {
    throw new GiraBleError(
      "Unerwartete Antwort von /thermostats",
      "bad_response",
      502,
    );
  }
  return list
    .map(normalizeThermostat)
    .filter((t): t is GiraThermostat => t !== null);
}

export async function setGiraThermostatSetpoint(
  id: string,
  celsius: number,
): Promise<GiraThermostat> {
  const target = clampSetpointC(celsius);
  const res = await giraFetch(
    `/thermostats/${encodeURIComponent(id)}/setpoint`,
    {
      method: "POST",
      timeoutMs: COMMAND_TIMEOUT_MS,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ celsius: target }),
    },
  );
  await throwIfNotOk(res);
  const body = await readJson(res);
  const thermostat = normalizeThermostat(body);
  if (!thermostat) {
    throw new GiraBleError(
      "Unerwartete Antwort vom Setpoint",
      "bad_response",
      502,
    );
  }
  return thermostat;
}

export async function listGiraCovers(): Promise<GiraCover[]> {
  const res = await giraFetch("/covers", {
    method: "GET",
    timeoutMs: LIST_TIMEOUT_MS,
  });
  await throwIfNotOk(res);
  const body = await readJson(res);
  const list = asDeviceList(body, "covers");
  if (!list) {
    throw new GiraBleError(
      "Unerwartete Antwort von /covers",
      "bad_response",
      502,
    );
  }
  return list.map(normalizeCover).filter((c): c is GiraCover => c !== null);
}

export async function commandGiraCover(
  id: string,
  action: GiraCoverAction,
): Promise<GiraCover> {
  const res = await giraFetch(`/covers/${encodeURIComponent(id)}/command`, {
    method: "POST",
    timeoutMs: COMMAND_TIMEOUT_MS,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action }),
  });
  await throwIfNotOk(res);
  const body = await readJson(res);
  const cover = normalizeCover(body);
  if (!cover) {
    throw new GiraBleError(
      "Unerwartete Antwort vom Cover-Befehl",
      "bad_response",
      502,
    );
  }
  return cover;
}
