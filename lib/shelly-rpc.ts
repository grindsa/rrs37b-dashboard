import { createHash, randomInt } from "node:crypto";
import { getShellyRpcPassword } from "./shelly-config";

const RPC_TIMEOUT_MS = 8_000;
const RPC_USER = "admin";
const RPC_URI = "/rpc";
/** Shelly expects WS-style ha2 when auth is sent inside the JSON-RPC body. */
const HA2_MATERIAL = "dummy_method:dummy_uri";

export class ShellyRpcError extends Error {
  constructor(
    message: string,
    readonly host: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "ShellyRpcError";
  }
}

type JsonRpcSuccess<T> = {
  id: number;
  result: T;
};

type JsonRpcFailure = {
  id: number;
  error: { code: number; message: string };
};

type DigestChallenge = {
  realm: string;
  nonce: string;
  algorithm: string;
  stale?: boolean;
};

type AuthSession = {
  realm: string;
  nonce: string;
  nc: number;
  ha1: string;
};

type ShellyAuth = {
  realm: string;
  username: string;
  nonce: string;
  cnonce: number;
  nc: string;
  response: string;
  algorithm: string;
};

/** Per-host digest sessions (nonce reuse with incrementing nc). */
const sessions = new Map<string, AuthSession>();

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function parseWwwAuthenticate(header: string): DigestChallenge {
  const realm = /realm="([^"]+)"/i.exec(header)?.[1];
  const nonce = /nonce="([^"]+)"/i.exec(header)?.[1];
  const algorithm =
    /algorithm=?"?([A-Za-z0-9-]+)"?/i.exec(header)?.[1] ?? "SHA-256";
  const stale = /stale=true/i.test(header) || undefined;

  if (!realm || !nonce) {
    throw new Error("Malformed WWW-Authenticate challenge");
  }

  return { realm, nonce, algorithm, stale };
}

function buildAuth(session: AuthSession): ShellyAuth {
  session.nc += 1;
  const nc = session.nc.toString(16).padStart(8, "0");
  const cnonce = randomInt(1, 0xffff_ffff);
  const ha2 = sha256Hex(HA2_MATERIAL);
  const response = sha256Hex(
    `${session.ha1}:${session.nonce}:${nc}:${cnonce}:auth:${ha2}`,
  );

  return {
    realm: session.realm,
    username: RPC_USER,
    nonce: session.nonce,
    cnonce,
    nc,
    response,
    algorithm: "SHA-256",
  };
}

function sessionFromChallenge(
  host: string,
  password: string,
  challenge: DigestChallenge,
): AuthSession {
  const ha1 = sha256Hex(`${RPC_USER}:${challenge.realm}:${password}`);
  const session: AuthSession = {
    realm: challenge.realm,
    nonce: challenge.nonce,
    nc: 0,
    ha1,
  };
  sessions.set(host, session);
  return session;
}

async function postRpc(
  host: string,
  method: string,
  params: Record<string, unknown> | undefined,
  auth: ShellyAuth | undefined,
  signal: AbortSignal,
): Promise<Response> {
  const body: Record<string, unknown> = { id: 1, method, params };
  if (auth) body.auth = auth;

  return fetch(`http://${host}${RPC_URI}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
    cache: "no-store",
  });
}

async function parseResult<T>(
  host: string,
  method: string,
  response: Response,
): Promise<T> {
  if (!response.ok) {
    throw new ShellyRpcError(
      `Shelly RPC HTTP ${response.status} for ${method}`,
      host,
      response.status,
    );
  }

  const payload = (await response.json()) as JsonRpcSuccess<T> | JsonRpcFailure;
  if ("error" in payload) {
    throw new ShellyRpcError(
      `Shelly RPC ${method}: ${payload.error.message}`,
      host,
    );
  }
  return payload.result;
}

export async function shellyRpc<T>(
  host: string,
  method: string,
  params?: Record<string, unknown>,
): Promise<T> {
  const password = getShellyRpcPassword();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), RPC_TIMEOUT_MS);

  try {
    const existing = password ? sessions.get(host) : undefined;
    let response = await postRpc(
      host,
      method,
      params,
      existing ? buildAuth(existing) : undefined,
      controller.signal,
    );

    if (response.status === 401) {
      if (!password) {
        throw new ShellyRpcError(
          "Shelly RPC auth required — set SHELLY_RPC_PASSWORD",
          host,
          401,
        );
      }

      const header = response.headers.get("www-authenticate");
      if (!header) {
        throw new ShellyRpcError(
          "Shelly RPC 401 without WWW-Authenticate challenge",
          host,
          401,
        );
      }

      const challenge = parseWwwAuthenticate(header);
      const session = sessionFromChallenge(host, password, challenge);
      response = await postRpc(
        host,
        method,
        params,
        buildAuth(session),
        controller.signal,
      );

      if (response.status === 401) {
        sessions.delete(host);
        throw new ShellyRpcError(
          "Shelly RPC auth failed — check SHELLY_RPC_PASSWORD",
          host,
          401,
        );
      }
    }

    if (response.status === 429) {
      throw new ShellyRpcError(
        "Shelly RPC rate-limited (auth backoff) — retry shortly",
        host,
        429,
      );
    }

    return await parseResult<T>(host, method, response);
  } catch (error) {
    if (error instanceof ShellyRpcError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new ShellyRpcError(`Shelly RPC timeout for ${method}`, host);
    }
    throw new ShellyRpcError(
      `Shelly RPC unreachable (${method}): ${error instanceof Error ? error.message : "unknown"}`,
      host,
    );
  } finally {
    clearTimeout(timer);
  }
}
