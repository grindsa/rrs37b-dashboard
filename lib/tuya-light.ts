/**
 * Local LEDVANCE / Tuya WiFi bulb control (LAN only).
 * Default DPs match Smart+ E27-style lights: 20 = on/off, 22 = brightness 10–1000.
 * One TCP session per device — queue per host and disconnect after each call.
 */

import TuyAPI from "tuyapi";

/** Status polls must fail fast so the Smarthome tab stays responsive. */
const TUYA_STATUS_TIMEOUT_MS = 2_500;
/** Control commands can wait a bit longer. */
const TUYA_CONTROL_TIMEOUT_MS = 6_000;
const MAX_QUEUE_DEPTH = 10;

/** Default LEDVANCE / Tuya light datapoints. */
export const TUYA_DP_POWER = 20;
export const TUYA_DP_BRIGHTNESS = 22;
export const TUYA_BRIGHTNESS_MIN = 10;
export const TUYA_BRIGHTNESS_MAX = 1000;

export class TuyaLightError extends Error {
  constructor(
    message: string,
    readonly host: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "TuyaLightError";
  }
}

export type TuyaLightCredentials = {
  ip: string;
  deviceId: string;
  localKey: string;
  /** Protocol version string, e.g. "3.5". */
  protocol: string;
};

export type TuyaLightState = {
  on: boolean;
  /** 0–100, null if brightness DP missing. */
  brightnessPct: number | null;
};

const hostTails = new Map<string, Promise<unknown>>();
const hostDepth = new Map<string, number>();

function withHostLock<T>(host: string, fn: () => Promise<T>): Promise<T> {
  const depth = hostDepth.get(host) ?? 0;
  if (depth >= MAX_QUEUE_DEPTH) {
    return Promise.reject(
      new TuyaLightError("Tuya busy — too many queued requests", host, 503),
    );
  }
  hostDepth.set(host, depth + 1);

  const prev = hostTails.get(host) ?? Promise.resolve();
  const run = prev.catch(() => undefined).then(fn);
  const tail = run
    .then(
      () => undefined,
      () => undefined,
    )
    .finally(() => {
      const left = (hostDepth.get(host) ?? 1) - 1;
      if (left > 0) hostDepth.set(host, left);
      else hostDepth.delete(host);
      if (hostTails.get(host) === tail) hostTails.delete(host);
    });
  hostTails.set(host, tail);
  return run;
}

function withTimeout<T>(
  promise: Promise<T>,
  host: string,
  timeoutMs: number,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new TuyaLightError("Tuya timeout", host, 504));
    }, timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function toTuyaError(host: string, error: unknown): TuyaLightError {
  if (error instanceof TuyaLightError) return error;
  const raw =
    error instanceof Error ? error.message : "Tuya-Befehl fehlgeschlagen";
  return new TuyaLightError(humanizeTuyaError(raw), host);
}

function humanizeTuyaError(raw: string): string {
  const text = raw.toLowerCase();
  if (text.includes("decrypt") || text.includes("data format")) {
    return "Tuya decrypt fehlgeschlagen — local_key / protocol prüfen";
  }
  if (text.includes("timeout") || text.includes("timed out")) {
    return "Tuya timeout — Lampe erreichbar? Smart+ App geschlossen?";
  }
  if (text.includes("econnrefused") || text.includes("ehostunreach")) {
    return "Tuya nicht erreichbar — IP / WLAN prüfen";
  }
  return raw;
}

/** Map 0–100% → device brightness scale (10–1000). */
export function percentToBrightness(percent: number): number {
  const pct = Math.max(0, Math.min(100, percent));
  const raw = Math.round((pct / 100) * TUYA_BRIGHTNESS_MAX);
  return Math.max(TUYA_BRIGHTNESS_MIN, Math.min(TUYA_BRIGHTNESS_MAX, raw));
}

/** Map device brightness (10–1000) → 0–100%. */
export function brightnessToPercent(value: number): number {
  const clamped = Math.max(
    TUYA_BRIGHTNESS_MIN,
    Math.min(TUYA_BRIGHTNESS_MAX, value),
  );
  return Math.round((clamped / TUYA_BRIGHTNESS_MAX) * 100);
}

function parseDps(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== "object") return {};
  const obj = raw as { dps?: Record<string, unknown> };
  if (obj.dps && typeof obj.dps === "object") return obj.dps;
  return raw as Record<string, unknown>;
}

function readStateFromDps(dps: Record<string, unknown>): TuyaLightState {
  const power = dps[String(TUYA_DP_POWER)];
  const bright = dps[String(TUYA_DP_BRIGHTNESS)];
  const on = typeof power === "boolean" ? power : Boolean(power);
  let brightnessPct: number | null = null;
  if (typeof bright === "number" && Number.isFinite(bright)) {
    brightnessPct = brightnessToPercent(bright);
  }
  return { on, brightnessPct };
}

type TuyDevice = InstanceType<typeof TuyAPI>;

/**
 * Connect, run `fn`, disconnect. One overall timeout for connect+work
 * (avoids stacking 2× timeouts on unreachable devices).
 */
async function withDevice<T>(
  creds: TuyaLightCredentials,
  timeoutMs: number,
  fn: (device: TuyDevice) => Promise<T>,
): Promise<T> {
  const version = Number(creds.protocol);
  const device = new TuyAPI({
    id: creds.deviceId,
    key: creds.localKey,
    ip: creds.ip,
    version: Number.isFinite(version) ? version : creds.protocol,
    issueGetOnConnect: false,
    issueRefreshOnConnect: false,
  });

  try {
    return await withTimeout(
      (async () => {
        await device.connect();
        return fn(device);
      })(),
      creds.ip,
      timeoutMs,
    );
  } catch (error) {
    throw toTuyaError(creds.ip, error);
  } finally {
    try {
      device.disconnect();
    } catch {
      /* ignore — may already be half-open after a timeout */
    }
  }
}

/** Read on/off + brightness (short timeout for status polling). */
export async function getTuyaLightState(
  creds: TuyaLightCredentials,
): Promise<TuyaLightState> {
  return withHostLock(creds.ip, () =>
    withDevice(creds, TUYA_STATUS_TIMEOUT_MS, async (device) => {
      // Prefer full schema; fall back to a plain get if needed.
      const raw = await device.get({ schema: true });
      return readStateFromDps(parseDps(raw));
    }),
  );
}

/** Turn off (power DP only). */
export async function setTuyaLightOff(
  creds: TuyaLightCredentials,
): Promise<void> {
  return withHostLock(creds.ip, () =>
    withDevice(creds, TUYA_CONTROL_TIMEOUT_MS, async (device) => {
      await device.set({ dps: TUYA_DP_POWER, set: false });
    }),
  );
}

/** Turn on at a brightness percent (sets power + brightness together). */
export async function setTuyaLightOn(
  creds: TuyaLightCredentials,
  brightnessPercent: number,
): Promise<void> {
  const brightness = percentToBrightness(brightnessPercent);
  return withHostLock(creds.ip, () =>
    withDevice(creds, TUYA_CONTROL_TIMEOUT_MS, async (device) => {
      await device.set({
        multiple: true,
        data: {
          [String(TUYA_DP_POWER)]: true,
          [String(TUYA_DP_BRIGHTNESS)]: brightness,
        },
      });
    }),
  );
}

/**
 * Apply a cycle target mode.
 * `dim` without `dimPercent` turns the lamp off (no dim target configured).
 */
export async function setTuyaLightMode(
  creds: TuyaLightCredentials,
  mode: "off" | "on" | "dim",
  onPercent: number,
  dimPercent?: number,
): Promise<void> {
  if (mode === "off") {
    await setTuyaLightOff(creds);
    return;
  }
  if (mode === "dim") {
    if (dimPercent === undefined) {
      await setTuyaLightOff(creds);
      return;
    }
    await setTuyaLightOn(creds, dimPercent);
    return;
  }
  await setTuyaLightOn(creds, onPercent);
}
