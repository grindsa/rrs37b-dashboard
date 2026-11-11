/**
 * Frontier Silicon / UNDOK FSAPI (Hama IR100/IR110 and similar).
 * Local LAN HTTP — GET/SET nodes with NetRemote PIN.
 */

const FSAPI_TIMEOUT_MS = 8_000;
const POWER_NODE = "netRemote.sys.power";
const VOLUME_NODE = "netRemote.sys.audio.volume";
const VOLUME_STEPS_NODE = "netRemote.sys.caps.volumeSteps";
/** Used when volumeSteps GET fails. */
const VOLUME_MAX_FALLBACK = 20;
const DEFAULT_PIN = "1234";
const DEFAULT_PORT = 80;

export class FsapiError extends Error {
  constructor(
    message: string,
    readonly host: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "FsapiError";
  }
}

/** @deprecated Prefer FsapiError — kept for existing catch sites. */
export class FsapiPowerError extends FsapiError {
  constructor(message: string, host: string, status?: number) {
    super(message, host, status);
    this.name = "FsapiPowerError";
  }
}

export type FsapiTarget = {
  ip: string;
  /** NetRemote PIN (default 1234). */
  pin?: string;
  /** HTTP port (default 80). */
  port?: number;
};

/** @deprecated Prefer FsapiTarget. */
export type FsapiPowerTarget = FsapiTarget;

function resolvePin(pin: string | undefined): string {
  const value = pin?.trim() || DEFAULT_PIN;
  if (!value) {
    throw new FsapiError("FSAPI PIN fehlt", "config", 500);
  }
  return value;
}

function resolvePort(port: number | undefined): number {
  return port ?? DEFAULT_PORT;
}

function nodeUrl(
  target: FsapiTarget,
  method: "GET" | "SET",
  node: string,
  value?: number,
): string {
  const pin = encodeURIComponent(resolvePin(target.pin));
  const port = resolvePort(target.port);
  const base = `http://${target.ip}:${port}/fsapi/${method}/${node}?pin=${pin}`;
  if (method === "SET") {
    return `${base}&value=${value ?? 0}`;
  }
  return base;
}

function parseFsStatus(xml: string): string | undefined {
  const match = /<status>\s*([^<]+?)\s*<\/status>/i.exec(xml);
  return match?.[1]?.trim();
}

/** Power/volume nodes commonly return `<u8>` or `<e8>`. */
function parseU8Value(xml: string): number | null {
  const match = /<(?:u8|e8)>\s*(\d+)\s*<\/(?:u8|e8)>/i.exec(xml);
  if (!match?.[1]) return null;
  const n = Number(match[1]);
  return Number.isInteger(n) ? n : null;
}

async function fsapiRequest(
  target: FsapiTarget,
  method: "GET" | "SET",
  node: string,
  value?: number,
): Promise<string> {
  const host = target.ip;
  const url = nodeUrl(target, method, node, value);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FSAPI_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: "GET",
      signal: controller.signal,
      cache: "no-store",
    });

    if (response.status === 403) {
      throw new FsapiError(
        "FSAPI PIN abgelehnt (HTTP 403) — NetRemote PIN prüfen",
        host,
        403,
      );
    }
    if (!response.ok) {
      throw new FsapiError(
        `FSAPI HTTP ${response.status}`,
        host,
        response.status,
      );
    }

    const xml = await response.text();
    const status = parseFsStatus(xml);
    if (status && status !== "FS_OK") {
      throw new FsapiError(`FSAPI status ${status}`, host);
    }
    if (!status) {
      throw new FsapiError("FSAPI Antwort ohne status", host);
    }
    return xml;
  } catch (error) {
    if (error instanceof FsapiError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new FsapiError("FSAPI timeout", host, 504);
    }
    const raw =
      error instanceof Error ? error.message : "FSAPI-Befehl fehlgeschlagen";
    throw new FsapiError(raw, host);
  } finally {
    clearTimeout(timer);
  }
}

/** Current power state (`1` = on, `0` = standby). */
export async function getFsapiPowerOn(target: FsapiTarget): Promise<boolean> {
  const xml = await fsapiRequest(target, "GET", POWER_NODE);
  const value = parseU8Value(xml);
  if (value !== 0 && value !== 1) {
    throw new FsapiError("FSAPI power ohne 0/1", target.ip);
  }
  return value === 1;
}

/** Set power on (1) or standby (0). Trusts FS_OK; no re-GET. */
export async function setFsapiPowerOn(
  target: FsapiTarget,
  on: boolean,
): Promise<void> {
  await fsapiRequest(target, "SET", POWER_NODE, on ? 1 : 0);
}

/** Current absolute volume level. */
export async function getFsapiVolume(target: FsapiTarget): Promise<number> {
  const xml = await fsapiRequest(target, "GET", VOLUME_NODE);
  const value = parseU8Value(xml);
  if (value === null || value < 0) {
    throw new FsapiError("FSAPI volume ungültig", target.ip);
  }
  return value;
}

/** Set absolute volume. Trusts FS_OK; no re-GET. */
export async function setFsapiVolume(
  target: FsapiTarget,
  volume: number,
): Promise<void> {
  if (!Number.isInteger(volume) || volume < 0) {
    throw new FsapiError("FSAPI volume muss >= 0 sein", target.ip, 400);
  }
  await fsapiRequest(target, "SET", VOLUME_NODE, volume);
}

/**
 * Max volume index = volumeSteps − 1 (zero is included in the step count).
 * Falls back to {@link VOLUME_MAX_FALLBACK} when caps cannot be read.
 */
export async function getFsapiVolumeMax(target: FsapiTarget): Promise<number> {
  try {
    const xml = await fsapiRequest(target, "GET", VOLUME_STEPS_NODE);
    const steps = parseU8Value(xml);
    if (steps === null || steps < 1) {
      return VOLUME_MAX_FALLBACK;
    }
    return Math.max(0, steps - 1);
  } catch {
    return VOLUME_MAX_FALLBACK;
  }
}

export type FsapiVolumeNudgeResult = {
  volume: number;
  volumeMax: number;
};

/** Read volume, clamp delta (±1 typical), SET, return new level + max. */
export async function nudgeFsapiVolume(
  target: FsapiTarget,
  delta: 1 | -1,
): Promise<FsapiVolumeNudgeResult> {
  const [current, volumeMax] = await Promise.all([
    getFsapiVolume(target),
    getFsapiVolumeMax(target),
  ]);
  const next = Math.min(volumeMax, Math.max(0, current + delta));
  if (next !== current) {
    await setFsapiVolume(target, next);
  }
  return { volume: next, volumeMax };
}
