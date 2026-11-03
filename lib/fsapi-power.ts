/**
 * Frontier Silicon / UNDOK FSAPI power control (Hama IR110 and similar).
 * Local LAN HTTP only — GET/SET netRemote.sys.power with NetRemote PIN.
 */

const FSAPI_TIMEOUT_MS = 8_000;
const POWER_NODE = "netRemote.sys.power";
const DEFAULT_PIN = "1234";
const DEFAULT_PORT = 80;

export class FsapiPowerError extends Error {
  constructor(
    message: string,
    readonly host: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "FsapiPowerError";
  }
}

export type FsapiPowerTarget = {
  ip: string;
  /** NetRemote PIN (default 1234). */
  pin?: string;
  /** HTTP port (default 80). */
  port?: number;
};

function resolvePin(pin: string | undefined): string {
  const value = pin?.trim() || DEFAULT_PIN;
  if (!value) {
    throw new FsapiPowerError("FSAPI PIN fehlt", "config", 500);
  }
  return value;
}

function resolvePort(port: number | undefined): number {
  return port ?? DEFAULT_PORT;
}

function powerUrl(
  target: FsapiPowerTarget,
  method: "GET" | "SET",
  value?: 0 | 1,
): string {
  const pin = encodeURIComponent(resolvePin(target.pin));
  const port = resolvePort(target.port);
  const base = `http://${target.ip}:${port}/fsapi/${method}/${POWER_NODE}?pin=${pin}`;
  if (method === "SET") {
    return `${base}&value=${value ?? 0}`;
  }
  return base;
}

function parseFsStatus(xml: string): string | undefined {
  const match = /<status>\s*([^<]+?)\s*<\/status>/i.exec(xml);
  return match?.[1]?.trim();
}

/** Power node is documented as E8; devices commonly return `<u8>`. */
function parsePowerValue(xml: string): number | null {
  const match = /<(?:u8|e8)>\s*(\d+)\s*<\/(?:u8|e8)>/i.exec(xml);
  if (!match?.[1]) return null;
  const n = Number(match[1]);
  return Number.isInteger(n) ? n : null;
}

async function fsapiRequest(
  target: FsapiPowerTarget,
  method: "GET" | "SET",
  value?: 0 | 1,
): Promise<string> {
  const host = target.ip;
  const url = powerUrl(target, method, value);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FSAPI_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: "GET",
      signal: controller.signal,
      cache: "no-store",
    });

    if (response.status === 403) {
      throw new FsapiPowerError(
        "FSAPI PIN abgelehnt (HTTP 403) — NetRemote PIN prüfen",
        host,
        403,
      );
    }
    if (!response.ok) {
      throw new FsapiPowerError(
        `FSAPI HTTP ${response.status}`,
        host,
        response.status,
      );
    }

    const xml = await response.text();
    const status = parseFsStatus(xml);
    if (status && status !== "FS_OK") {
      throw new FsapiPowerError(`FSAPI status ${status}`, host);
    }
    if (!status) {
      throw new FsapiPowerError("FSAPI Antwort ohne status", host);
    }
    return xml;
  } catch (error) {
    if (error instanceof FsapiPowerError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new FsapiPowerError("FSAPI timeout", host, 504);
    }
    const raw =
      error instanceof Error ? error.message : "FSAPI-Befehl fehlgeschlagen";
    throw new FsapiPowerError(raw, host);
  } finally {
    clearTimeout(timer);
  }
}

/** Current power state (`1` = on, `0` = standby). */
export async function getFsapiPowerOn(
  target: FsapiPowerTarget,
): Promise<boolean> {
  const xml = await fsapiRequest(target, "GET");
  const value = parsePowerValue(xml);
  if (value !== 0 && value !== 1) {
    throw new FsapiPowerError("FSAPI power ohne 0/1", target.ip);
  }
  return value === 1;
}

/** Set power on (1) or standby (0). Trusts FS_OK; no re-GET. */
export async function setFsapiPowerOn(
  target: FsapiPowerTarget,
  on: boolean,
): Promise<void> {
  await fsapiRequest(target, "SET", on ? 1 : 0);
}
