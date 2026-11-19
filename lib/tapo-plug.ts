/**
 * Local Tapo plug control (P100 and similar) via KLAP.
 * Talks to the device LAN IP only — TAPO_EMAIL / TAPO_PASSWORD are used to
 * derive the local session, not for cloud switching.
 */

// KLAP only — the package's loginDeviceByIp falls back to legacy secure
// passthrough, which on modern firmware throws "Legacy login not supported"
// and hides the real KLAP failure (wrong password vs HTTP 403).
import { loginDeviceByIp as loginKlapDeviceByIp } from "tp-link-tapo-connect/dist/klap-transport";

const TAPO_TIMEOUT_MS = 8_000;
const SESSION_TTL_MS = 10 * 60_000;
const MAX_QUEUE_DEPTH = 10;

const CREDENTIALS_HINT =
  "Tapo-Login fehlgeschlagen — TAPO_EMAIL / TAPO_PASSWORD prüfen " +
  "(Sonderzeichen in .env in Anführungszeichen setzen)";

const KLAP_FORBIDDEN_HINT =
  "Tapo KLAP abgelehnt (HTTP 403) — in der Tapo-App " +
  "Me → Third-Party Services → Third-Party Compatibility einschalten " +
  "(ggf. aus/an, ~1 Min warten)";

export class TapoPlugError extends Error {
  constructor(
    message: string,
    readonly host: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "TapoPlugError";
  }
}

type TapoDeviceSession = {
  turnOn: () => Promise<void>;
  turnOff: () => Promise<void>;
  getDeviceInfo: () => Promise<{ device_on?: boolean }>;
};

type CachedSession = {
  device: TapoDeviceSession;
  expiresAt: number;
};

const sessions = new Map<string, CachedSession>();
const hostTails = new Map<string, Promise<unknown>>();
const hostDepth = new Map<string, number>();

function withHostLock<T>(host: string, fn: () => Promise<T>): Promise<T> {
  const depth = hostDepth.get(host) ?? 0;
  if (depth >= MAX_QUEUE_DEPTH) {
    return Promise.reject(
      new TapoPlugError("Tapo busy — too many queued requests", host, 503),
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

function withTimeout<T>(promise: Promise<T>, host: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new TapoPlugError("Tapo timeout", host, 504));
    }, TAPO_TIMEOUT_MS);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function getTapoCredentials(): { email: string; password: string } {
  const email = process.env.TAPO_EMAIL?.trim();
  const password = process.env.TAPO_PASSWORD?.trim();
  if (!email || !password) {
    throw new TapoPlugError(
      "TAPO_EMAIL / TAPO_PASSWORD fehlen",
      "env",
      500,
    );
  }
  return { email, password };
}

function invalidateSession(host: string): void {
  sessions.delete(host);
}

function getValidCachedSession(host: string): TapoDeviceSession | undefined {
  const cached = sessions.get(host);
  if (!cached) return undefined;
  if (cached.expiresAt <= Date.now()) {
    sessions.delete(host);
    return undefined;
  }
  return cached.device;
}

async function createSession(host: string): Promise<TapoDeviceSession> {
  const { email, password } = getTapoCredentials();
  const device = (await withTimeout(
    loginKlapDeviceByIp(email, password, host),
    host,
  )) as TapoDeviceSession;

  sessions.set(host, {
    device,
    expiresAt: Date.now() + SESSION_TTL_MS,
  });
  return device;
}

async function withSession<T>(
  host: string,
  fn: (device: TapoDeviceSession) => Promise<T>,
): Promise<T> {
  const cached = getValidCachedSession(host);
  try {
    const device = cached ?? (await createSession(host));
    return await withTimeout(fn(device), host);
  } catch (error) {
    invalidateSession(host);
    if (!cached) throw toTapoError(host, error);
    // Cached session rejected — one fresh handshake.
    try {
      const device = await createSession(host);
      return await withTimeout(fn(device), host);
    } catch (retryError) {
      invalidateSession(host);
      throw toTapoError(host, retryError);
    }
  }
}

function toTapoError(host: string, error: unknown): TapoPlugError {
  if (error instanceof TapoPlugError) return error;
  const raw =
    error instanceof Error ? error.message : "Tapo-Befehl fehlgeschlagen";
  return new TapoPlugError(humanizeTapoError(raw), host);
}

/** Map library/protocol noise to actionable messages. */
function humanizeTapoError(raw: string): string {
  const text = raw.toLowerCase();
  // Credentials before 403: a hash mismatch must not be reported as
  // Third-Party Compatibility (that was the prod/dev confusion).
  if (
    text.includes("email or password incorrect") ||
    text.includes("incorrect email or password") ||
    text.includes("invalid credentials")
  ) {
    return CREDENTIALS_HINT;
  }
  // If a caller still uses the package wrapper, legacy-fallback failure after
  // a KLAP auth miss usually means bad credentials — not Third-Party mode.
  if (text.includes("legacy login not supported")) {
    return CREDENTIALS_HINT;
  }
  if (
    text.includes("handshake1 failed") ||
    text.includes("status code 403") ||
    text.includes("forbidden")
  ) {
    return KLAP_FORBIDDEN_HINT;
  }
  if (text.includes("tapo_email") || text.includes("tapo_password")) {
    return "TAPO_EMAIL / TAPO_PASSWORD fehlen";
  }
  return raw;
}

/** Current relay state (`device_on`). */
export async function getTapoPlugOn(host: string): Promise<boolean> {
  return withHostLock(host, async () => {
    const info = await withSession(host, (device) => device.getDeviceInfo());
    if (typeof info.device_on !== "boolean") {
      throw new TapoPlugError("Tapo status ohne device_on", host);
    }
    return info.device_on;
  });
}

/** Set relay on/off. */
export async function setTapoPlugOn(host: string, on: boolean): Promise<void> {
  return withHostLock(host, async () => {
    await withSession(host, (device) =>
      on ? device.turnOn() : device.turnOff(),
    );
  });
}
