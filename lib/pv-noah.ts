/**
 * Growatt NOAH 2000 SoC via noah-mqtt → local MQTT broker.
 * Keeps a process-level subscriber so retained messages are not required.
 *
 * noah-mqtt polls Growatt ~every 30s and publishes `status: "online"|"offline"`.
 * We reject offline / stale readings so the dashboard does not keep showing
 * the last SoC after WiFi drops.
 */

import mqtt, { type MqttClient } from "mqtt";

export type NoahReading = {
  socPct: number;
  chargeW: number | null;
  dischargeW: number | null;
  outputW: number | null;
  solarW: number | null;
  status: string | null;
  topic: string;
  updatedAt: string;
};

type NoahPayload = {
  soc?: number;
  charge_w?: number;
  discharge_w?: number;
  output_w?: number;
  solar_w?: number;
  status?: string;
};

const CONNECT_TIMEOUT_MS = 5_000;
const FIRST_MESSAGE_WAIT_MS = 12_000;
/** noah-mqtt default poll is 30s; allow a few missed cycles + Growatt lag. */
const STALE_AFTER_MS = 3 * 60_000;

let client: MqttClient | null = null;
let latest: NoahReading | null = null;
let lastError: string | null = null;
let startPromise: Promise<void> | null = null;
let subscribedUrl: string | null = null;
let subscribedTopic: string | null = null;

function envUrl(): string | null {
  const v = process.env.NOAH_MQTT_URL?.trim();
  return v || null;
}

function envTopic(): string {
  return process.env.NOAH_MQTT_TOPIC?.trim() || "noah2mqtt/+";
}

function envUser(): string | undefined {
  const v = process.env.NOAH_MQTT_USERNAME?.trim();
  return v || undefined;
}

function envPassword(): string | undefined {
  const v = process.env.NOAH_MQTT_PASSWORD?.trim();
  return v || undefined;
}

function asFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function isFresh(iso: string): boolean {
  const ageMs = Date.now() - new Date(iso).getTime();
  return Number.isFinite(ageMs) && ageMs <= STALE_AFTER_MS;
}

/** noah-mqtt sets status to "offline" when Growatt reports the appliance unreachable. */
function isReportedOffline(status: string | null): boolean {
  return typeof status === "string" && status.trim().toLowerCase() === "offline";
}

function assertUsableReading(reading: NoahReading): void {
  if (isReportedOffline(reading.status)) {
    throw new Error("NOAH Batterie offline (kein WLAN / Growatt)");
  }
  if (!isFresh(reading.updatedAt)) {
    throw new Error(
      "NOAH SoC veraltet — keine aktuelle MQTT-Meldung (läuft noah-mqtt?)",
    );
  }
}

function parsePayload(topic: string, raw: Buffer): NoahReading | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.toString("utf8"));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const data = parsed as NoahPayload;
  const soc = asFiniteNumber(data.soc);
  if (soc === null) return null;

  return {
    socPct: soc,
    chargeW: asFiniteNumber(data.charge_w),
    dischargeW: asFiniteNumber(data.discharge_w),
    outputW: asFiniteNumber(data.output_w),
    solarW: asFiniteNumber(data.solar_w),
    status: typeof data.status === "string" ? data.status : null,
    topic,
    updatedAt: new Date().toISOString(),
  };
}

function stopClient(): void {
  if (client) {
    try {
      client.removeAllListeners();
      client.end(true);
    } catch {
      // ignore shutdown errors
    }
  }
  client = null;
  startPromise = null;
  subscribedUrl = null;
  subscribedTopic = null;
}

function ensureSubscriber(url: string, topic: string): Promise<void> {
  if (
    client?.connected &&
    subscribedUrl === url &&
    subscribedTopic === topic
  ) {
    return Promise.resolve();
  }

  if (
    startPromise &&
    subscribedUrl === url &&
    subscribedTopic === topic
  ) {
    return startPromise;
  }

  stopClient();
  subscribedUrl = url;
  subscribedTopic = topic;
  lastError = null;

  startPromise = new Promise<void>((resolve, reject) => {
    let settled = false;
    const username = envUser();
    const password = envPassword();

    const next = mqtt.connect(url, {
      connectTimeout: CONNECT_TIMEOUT_MS,
      reconnectPeriod: 5_000,
      username,
      password,
      clientId: `rrs37b-dashboard-${process.pid}`,
    });
    client = next;

    const settleOk = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve();
    };
    const settleErr = (err: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      lastError = err.message;
      reject(err);
    };

    const timer = setTimeout(() => {
      settleErr(new Error("MQTT connect timeout — läuft mosquitto?"));
    }, CONNECT_TIMEOUT_MS + 500);

    next.once("connect", () => {
      next.subscribe(topic, (err) => {
        if (err) {
          settleErr(new Error(`MQTT subscribe failed: ${err.message}`));
          return;
        }
        settleOk();
      });
    });
    next.on("message", (msgTopic, payload) => {
      // Ignore nested BAT*/parameters topics — only device root JSON has appliance SoC.
      const parts = msgTopic.split("/");
      if (parts.length !== 2) return;
      const reading = parsePayload(msgTopic, payload);
      if (reading) {
        latest = reading;
        lastError = null;
      }
    });
    next.on("error", (err) => {
      lastError = err.message;
      if (!settled) settleErr(err);
    });
    next.on("close", () => {
      if (!latest) {
        lastError = lastError ?? "MQTT Verbindung getrennt";
      }
    });
  }).catch((err) => {
    stopClient();
    throw err;
  });

  return startPromise;
}

function waitForReading(timeoutMs: number): Promise<NoahReading | null> {
  if (latest) return Promise.resolve(latest);

  return new Promise((resolve) => {
    const started = Date.now();
    const id = setInterval(() => {
      if (latest) {
        clearInterval(id);
        resolve(latest);
        return;
      }
      if (Date.now() - started >= timeoutMs) {
        clearInterval(id);
        resolve(null);
      }
    }, 200);
  });
}

/**
 * Returns latest NOAH reading from the MQTT bridge, or null if not configured.
 * Throws when configured but the broker / payload is unavailable, offline,
 * or older than the stale threshold (~3 minutes).
 */
export async function fetchNoahReading(): Promise<NoahReading | null> {
  const url = envUrl();
  if (!url) return null;

  const topic = envTopic();
  await ensureSubscriber(url, topic);

  const reading = await waitForReading(FIRST_MESSAGE_WAIT_MS);
  if (!reading) {
    throw new Error(
      lastError ??
        `Keine NOAH-SoC Nachricht auf ${topic} — läuft noah-mqtt?`,
    );
  }

  assertUsableReading(reading);
  return reading;
}
