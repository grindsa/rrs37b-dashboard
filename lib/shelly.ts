/**
 * Shelly LAN RPC adapter — BLU H&T via Plug S Gen3 BTHome components.
 */

import { CACHE_TTL, cacheDelete, cacheGetOrSet } from "./cache";
import {
  getShellyBindings,
  uniqueGatewayIps,
  type SensorBinding,
  type SensorLabel,
} from "./shelly-config";
import { ShellyRpcError, shellyRpc } from "./shelly-rpc";

export type ShellySensor = {
  id: string;
  label: SensorLabel;
  temperatureC: number | null;
  humidityPct: number | null;
  batteryPct: number | null;
  updatedAt: string | null;
  online: boolean;
  gatewayIp?: string;
  mac?: string;
};

export type ShellySensorsResult = {
  sensors: ShellySensor[];
  fetchedAt: string;
  warnings: string[];
};

export type DiscoveredBthomeDevice = {
  gatewayIp: string;
  componentId: number;
  key: string;
  mac: string;
  name: string | null;
  batteryPct: number | null;
  rssi: number | null;
  lastUpdatedAt: string | null;
  sensors: {
    id: number;
    key: string;
    name: string | null;
    objId: number;
    kind: "temperature" | "humidity" | "battery" | "other";
    value: number | boolean | string | null;
    lastUpdatedAt: string | null;
  }[];
};

type ComponentEntry = {
  key: string;
  status?: Record<string, unknown>;
  config?: Record<string, unknown>;
};

type GetComponentsResult = {
  components: ComponentEntry[];
  offset: number;
  total: number;
};

/** BTHome object IDs we care about (Shelly BTHome.GetObjectInfos). */
const OBJ = {
  battery: new Set([1]),
  temperature: new Set([2, 69]),
  humidity: new Set([3, 46]),
} as const;

const STALE_AFTER_MS = 15 * 60_000;

function normalizeMac(value: string): string {
  return value.trim().toLowerCase().replace(/-/g, ":");
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function tsToIso(ts: unknown): string | null {
  const n = asNumber(ts);
  if (n === null || n <= 0) return null;
  return new Date(n * 1000).toISOString();
}

function latestIso(...values: Array<string | null | undefined>): string | null {
  const times = values
    .filter((v): v is string => Boolean(v))
    .map((v) => new Date(v).getTime())
    .filter((n) => Number.isFinite(n));
  if (times.length === 0) return null;
  return new Date(Math.max(...times)).toISOString();
}

function sensorKind(
  objId: number,
): "temperature" | "humidity" | "battery" | "other" {
  if (OBJ.temperature.has(objId)) return "temperature";
  if (OBJ.humidity.has(objId)) return "humidity";
  if (OBJ.battery.has(objId)) return "battery";
  return "other";
}

function isFresh(iso: string | null): boolean {
  if (!iso) return false;
  return Date.now() - new Date(iso).getTime() <= STALE_AFTER_MS;
}

async function getDynamicComponents(host: string): Promise<ComponentEntry[]> {
  const all: ComponentEntry[] = [];
  let offset = 0;

  for (;;) {
    const page = await shellyRpc<GetComponentsResult>(host, "Shelly.GetComponents", {
      offset,
      include: ["config", "status"],
      dynamic_only: true,
    });
    all.push(...(page.components ?? []));
    const next = offset + (page.components?.length ?? 0);
    if (!page.components?.length || next >= page.total) break;
    offset = next;
  }

  return all;
}

function parseDevices(
  gatewayIp: string,
  components: ComponentEntry[],
): DiscoveredBthomeDevice[] {
  const devices = components.filter((c) => c.key.startsWith("bthomedevice:"));
  const sensors = components.filter((c) => c.key.startsWith("bthomesensor:"));

  return devices.map((device) => {
    const id = Number(device.key.split(":")[1]);
    const mac = normalizeMac(String(device.config?.addr ?? ""));
    const deviceSensors = sensors
      .filter((s) => normalizeMac(String(s.config?.addr ?? "")) === mac)
      .map((s) => {
        const sensorId = Number(s.key.split(":")[1]);
        const objId = Number(s.config?.obj_id ?? -1);
        return {
          id: sensorId,
          key: s.key,
          name: typeof s.config?.name === "string" ? s.config.name : null,
          objId,
          kind: sensorKind(objId),
          value:
            typeof s.status?.value === "number" ||
            typeof s.status?.value === "boolean" ||
            typeof s.status?.value === "string"
              ? s.status.value
              : null,
          lastUpdatedAt: tsToIso(
            s.status?.last_updated_ts ?? s.status?.last_update_ts,
          ),
        };
      });

    return {
      gatewayIp,
      componentId: id,
      key: device.key,
      mac,
      name: typeof device.config?.name === "string" ? device.config.name : null,
      batteryPct: asNumber(device.status?.battery),
      rssi: asNumber(device.status?.rssi),
      lastUpdatedAt: tsToIso(
        device.status?.last_updated_ts ?? device.status?.last_update_ts,
      ),
      sensors: deviceSensors,
    };
  });
}

export async function discoverBthomeDevices(
  hosts?: string[],
): Promise<DiscoveredBthomeDevice[]> {
  const ips = hosts ?? uniqueGatewayIps(getShellyBindings());
  const discovered: DiscoveredBthomeDevice[] = [];

  for (const host of ips) {
    const components = await getDynamicComponents(host);
    discovered.push(...parseDevices(host, components));
  }

  return discovered;
}

function matchDevice(
  binding: SensorBinding,
  devices: DiscoveredBthomeDevice[],
): DiscoveredBthomeDevice | undefined {
  const onGateway = devices.filter((d) => d.gatewayIp === binding.gatewayIp);

  if (binding.mac) {
    return (
      onGateway.find((d) => d.mac === binding.mac) ??
      devices.find((d) => d.mac === binding.mac)
    );
  }

  const needle = binding.label.toLowerCase();
  return onGateway.find((d) => d.name?.toLowerCase().includes(needle));
}

function deviceToSensor(
  binding: SensorBinding,
  device: DiscoveredBthomeDevice | undefined,
  warningSink: string[],
): ShellySensor {
  if (!device) {
    if (!binding.mac) {
      warningSink.push(
        `${binding.label}: no SHELLY_SENSOR_* MAC set and no BTHome device named "${binding.label}" on ${binding.gatewayIp}`,
      );
    } else {
      warningSink.push(
        `${binding.label}: BTHome device ${binding.mac} not found on ${binding.gatewayIp}`,
      );
    }
    return {
      id: binding.label.toLowerCase(),
      label: binding.label,
      temperatureC: null,
      humidityPct: null,
      batteryPct: null,
      updatedAt: null,
      online: false,
      gatewayIp: binding.gatewayIp,
      mac: binding.mac,
    };
  }

  const temp = device.sensors.find((s) => s.kind === "temperature");
  const humidity = device.sensors.find((s) => s.kind === "humidity");
  const batterySensor = device.sensors.find((s) => s.kind === "battery");

  const temperatureC = asNumber(temp?.value);
  const humidityPct = asNumber(humidity?.value);
  const batteryPct =
    asNumber(batterySensor?.value) ?? asNumber(device.batteryPct);

  const updatedAt = latestIso(
    temp?.lastUpdatedAt,
    humidity?.lastUpdatedAt,
    batterySensor?.lastUpdatedAt,
  );

  if (!temp) {
    warningSink.push(
      `${binding.label}: BTHome temperature sensor missing — add it on the Plug UI (or encryption key if parse_failed)`,
    );
  }
  if (!humidity) {
    warningSink.push(
      `${binding.label}: BTHome humidity sensor missing — add it on the Plug UI (or encryption key if parse_failed)`,
    );
  }

  const hasReading = temperatureC !== null || humidityPct !== null;

  return {
    id: binding.label.toLowerCase(),
    label: binding.label,
    temperatureC,
    humidityPct,
    batteryPct,
    updatedAt,
    online: hasReading && isFresh(updatedAt),
    gatewayIp: device.gatewayIp,
    mac: device.mac,
  };
}

async function loadShellySensors(): Promise<ShellySensorsResult> {
  const bindings = getShellyBindings();
  const warnings: string[] = [];
  const devices: DiscoveredBthomeDevice[] = [];

  for (const host of uniqueGatewayIps(bindings)) {
    try {
      const components = await getDynamicComponents(host);
      const parsed = parseDevices(host, components);
      devices.push(...parsed);
      if (parsed.length === 0) {
        warnings.push(
          `${host}: no BTHome devices paired yet (enable Bluetooth observer, then add BLU H&T under BTHome components)`,
        );
      }
    } catch (error) {
      const message =
        error instanceof ShellyRpcError
          ? error.message
          : error instanceof Error
            ? error.message
            : "unknown error";
      warnings.push(`${host}: ${message}`);
    }
  }

  const sensors = bindings.map((binding) =>
    deviceToSensor(binding, matchDevice(binding, devices), warnings),
  );

  return {
    sensors,
    fetchedAt: new Date().toISOString(),
    warnings,
  };
}

export async function getShellySensors(): Promise<ShellySensorsResult> {
  return cacheGetOrSet("shelly:sensors", CACHE_TTL.shelly, loadShellySensors);
}

/** Drop cached sensor snapshot (e.g. after auth/config changes). */
export function invalidateShellySensorsCache(): void {
  cacheDelete("shelly:sensors");
}
