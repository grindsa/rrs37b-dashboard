/**
 * Heating snapshot: join smarthome.yml thermostat layout with live
 * gira-ble-api state, plus optional BLU H&T sensors that have `group:` set
 * (read-only climate rows on the same floor). Empty floors are omitted.
 */

import {
  findThermostat,
  getLiveSmarthomeConfig,
  getSmarthomeConfig,
  heatingSensors,
  type SmarthomeConfig,
  type SmarthomeThermostatConfig,
} from "@/lib/smarthome-config";
import {
  GiraBleError,
  isGiraBleConfigured,
  listGiraThermostats,
  setGiraThermostatSetpoint,
  type GiraThermostat,
} from "@/lib/gira-ble";
import { takeControlSlot } from "@/lib/control-throttle";
import { getShellySensors, type ShellySensor } from "@/lib/shelly";

export type HeatingThermostatStatus = {
  id: string;
  name: string;
  /** Config `group_primary: true` — Ist shown on the floor group header. */
  groupPrimary: boolean;
  online: boolean;
  paired: boolean | null;
  temperatureC: number | null;
  setpointC: number | null;
  /** From gira-ble-api `heating_active`; null until GATT poll / setpoint write. */
  heatingActive: boolean | null;
  lastSeenAt: string | null;
  updatedAt: string | null;
  error: string | null;
};

/** Read-only BLU H&T assigned to a Heizung floor via YAML `group`. */
export type HeatingSensorStatus = {
  id: string;
  name: string;
  online: boolean;
  temperatureC: number | null;
  humidityPct: number | null;
  batteryPct: number | null;
  updatedAt: string | null;
  error: string | null;
};

export type HeatingGroupStatus = {
  id: string;
  name: string;
  thermostats: HeatingThermostatStatus[];
  sensors: HeatingSensorStatus[];
};

export type HeatingSnapshot = {
  groups: HeatingGroupStatus[];
  fetchedAt: string;
  configured: boolean;
  warnings: string[];
  error?: string;
};

function toStatus(
  live: GiraThermostat,
  displayName: string | undefined,
  groupPrimary = false,
): HeatingThermostatStatus {
  return {
    id: live.id,
    name: displayName?.trim() || live.name,
    groupPrimary,
    online: live.online,
    paired: live.paired,
    temperatureC: live.temperature_c,
    setpointC: live.setpoint_c,
    heatingActive: live.heating_active,
    lastSeenAt: live.last_seen_at,
    updatedAt: live.updated_at,
    error: live.error,
  };
}

function toSensorStatus(
  label: string,
  live: ShellySensor | undefined,
): HeatingSensorStatus {
  return {
    id: `blu:${label.toLowerCase()}`,
    name: label,
    online: live?.online ?? false,
    temperatureC: live?.temperatureC ?? null,
    humidityPct: live?.humidityPct ?? null,
    batteryPct: live?.batteryPct ?? null,
    updatedAt: live?.updatedAt ?? null,
    error: live ? null : "Kein Messwert",
  };
}

function buildGroups(
  config: SmarthomeConfig,
  byId: Map<string, GiraThermostat>,
  shellyByLabel: Map<string, ShellySensor>,
): HeatingGroupStatus[] {
  return config.floorGroups
    .map((group) => {
      const members = config.thermostats.filter((t) => t.groupId === group.id);
      const thermostats: HeatingThermostatStatus[] = [];
      for (const member of members) {
        const live = byId.get(member.id);
        if (!live) continue;
        thermostats.push(toStatus(live, member.name, member.groupPrimary));
      }

      const climate = config.sensors.filter((s) => s.groupId === group.id);
      const sensors = climate.map((s) =>
        toSensorStatus(s.label, shellyByLabel.get(s.label)),
      );

      return {
        id: group.id,
        name: group.name,
        thermostats,
        sensors,
      };
    })
    .filter((g) => g.thermostats.length > 0 || g.sensors.length > 0);
}

function layoutWarnings(configLoad: ReturnType<typeof getSmarthomeConfig>): string[] {
  if (!configLoad.ok) return [configLoad.error];
  if (configLoad.source === "example") return [configLoad.warning];
  return [];
}

async function loadShellyByLabel(
  config: SmarthomeConfig,
  warnings: string[],
): Promise<Map<string, ShellySensor>> {
  if (heatingSensors(config).length === 0) return new Map();
  try {
    const result = await getShellySensors();
    for (const w of result.warnings) {
      if (!warnings.includes(w)) warnings.push(w);
    }
    return new Map(result.sensors.map((s) => [s.label, s]));
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "BLU-Sensoren fehlgeschlagen";
    warnings.push(message);
    return new Map();
  }
}

export async function getHeatingSnapshot(): Promise<HeatingSnapshot> {
  const fetchedAt = new Date().toISOString();
  const load = getSmarthomeConfig();
  const warnings = layoutWarnings(load);
  const shellyByLabel = await loadShellyByLabel(load.config, warnings);

  if (!isGiraBleConfigured()) {
    return {
      groups: buildGroups(load.config, new Map(), shellyByLabel),
      fetchedAt,
      configured: false,
      warnings: [
        ...warnings,
        "Heizung-Proxy nicht konfiguriert (GIRA_BLE_API_URL)",
      ],
    };
  }

  try {
    const list = await listGiraThermostats();
    const byId = new Map(list.map((t) => [t.id, t]));
    return {
      groups: buildGroups(load.config, byId, shellyByLabel),
      fetchedAt,
      configured: true,
      warnings,
    };
  } catch (error) {
    const message =
      error instanceof GiraBleError
        ? error.message
        : error instanceof Error
          ? error.message
          : "Heizung-Status fehlgeschlagen";
    return {
      groups: buildGroups(load.config, new Map(), shellyByLabel),
      fetchedAt,
      configured: true,
      warnings,
      error: message,
    };
  }
}

export type SetpointResult = {
  ok: boolean;
  thermostat?: HeatingThermostatStatus;
  error?: string;
  code?: string;
};

export async function runSetpoint(
  thermostatId: string,
  celsius: number,
): Promise<SetpointResult> {
  const id = thermostatId.trim();
  if (!id) {
    return { ok: false, error: "Thermostat-ID fehlt", code: "bad_request" };
  }
  if (!Number.isFinite(celsius)) {
    return { ok: false, error: "Ungültige Temperatur", code: "bad_request" };
  }

  const liveConfig = getLiveSmarthomeConfig();
  if (!liveConfig.ok) {
    return { ok: false, error: liveConfig.error, code: "not_configured" };
  }

  const configured: SmarthomeThermostatConfig | undefined = findThermostat(
    liveConfig.config,
    id,
  );
  if (!configured) {
    return {
      ok: false,
      error: "Unbekanntes Thermostat",
      code: "not_found",
    };
  }

  if (!isGiraBleConfigured()) {
    return {
      ok: false,
      error: "Heizung-Proxy nicht konfiguriert",
      code: "not_configured",
    };
  }

  takeControlSlot([`heating:${id}`]);

  try {
    const live = await setGiraThermostatSetpoint(id, celsius);
    return {
      ok: true,
      thermostat: toStatus(live, configured.name, configured.groupPrimary),
    };
  } catch (error) {
    if (error instanceof GiraBleError) {
      return { ok: false, error: error.message, code: error.code };
    }
    return {
      ok: false,
      error:
        error instanceof Error ? error.message : "Sollwert setzen fehlgeschlagen",
      code: "unknown",
    };
  }
}
