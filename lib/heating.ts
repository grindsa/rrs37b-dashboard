/**
 * Heating snapshot: join smarthome.yml thermostat layout with live
 * gira-ble-api state. Floor sections reuse shared group ids/names; empty
 * floors (no live members) are omitted.
 */

import {
  findThermostat,
  getLiveSmarthomeConfig,
  getSmarthomeConfig,
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

export type HeatingThermostatStatus = {
  id: string;
  name: string;
  online: boolean;
  paired: boolean | null;
  temperatureC: number | null;
  setpointC: number | null;
  lastSeenAt: string | null;
  updatedAt: string | null;
  error: string | null;
};

export type HeatingGroupStatus = {
  id: string;
  name: string;
  thermostats: HeatingThermostatStatus[];
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
): HeatingThermostatStatus {
  return {
    id: live.id,
    name: displayName?.trim() || live.name,
    online: live.online,
    paired: live.paired,
    temperatureC: live.temperature_c,
    setpointC: live.setpoint_c,
    lastSeenAt: live.last_seen_at,
    updatedAt: live.updated_at,
    error: live.error,
  };
}

function buildGroups(
  config: SmarthomeConfig,
  byId: Map<string, GiraThermostat>,
): HeatingGroupStatus[] {
  return config.floorGroups
    .map((group) => {
      const members = config.thermostats.filter((t) => t.groupId === group.id);
      const thermostats: HeatingThermostatStatus[] = [];
      for (const member of members) {
        const live = byId.get(member.id);
        if (!live) continue;
        thermostats.push(toStatus(live, member.name));
      }
      return {
        id: group.id,
        name: group.name,
        thermostats,
      };
    })
    .filter((g) => g.thermostats.length > 0);
}

function layoutWarnings(configLoad: ReturnType<typeof getSmarthomeConfig>): string[] {
  if (!configLoad.ok) return [configLoad.error];
  if (configLoad.source === "example") return [configLoad.warning];
  return [];
}

export async function getHeatingSnapshot(): Promise<HeatingSnapshot> {
  const fetchedAt = new Date().toISOString();
  const load = getSmarthomeConfig();
  const warnings = layoutWarnings(load);

  if (!isGiraBleConfigured()) {
    return {
      groups: [],
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
      groups: buildGroups(load.config, byId),
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
      groups: [],
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
      thermostat: toStatus(live, configured.name),
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
