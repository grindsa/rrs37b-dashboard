import {
  cacheDelete,
  cacheGetOrSet,
  cacheGetStale,
  cacheHasFresh,
  CACHE_TTL,
} from "./cache";
import { shellyRpc, ShellyRpcError } from "./shelly-rpc";
import { takeControlSlot } from "./control-throttle";
import { getTapoPlugOn, setTapoPlugOn, TapoPlugError } from "./tapo-plug";
import {
  classifyLightMode,
  nextLightMode,
  summarizeLightGroupModes,
  type LightGroupMode,
  type LightMode,
  type LightModeOrUnknown,
} from "./light-mode";
import {
  getTuyaLightState,
  setTuyaLightMode,
  TuyaLightError,
  type TuyaLightCredentials,
} from "./tuya-light";
import {
  coverGroups,
  findCover,
  findCoverGroup,
  findLamp,
  findLightGroup,
  findPlug,
  getSmarthomeConfig,
  lightGroups,
  visiblePlugs,
  type SmarthomeConfig,
  type SmarthomeCoverConfig,
  type SmarthomeLampConfig,
  type SmarthomePlugConfig,
} from "./smarthome-config";

const STATUS_CACHE_KEY = "smarthome:status";

/** After a lamp status timeout/error, skip re-probing briefly so the tab stays snappy. */
const LAMP_OFFLINE_BACKOFF_MS = 45_000;

type LampOfflineEntry = {
  until: number;
  status: LampDeviceStatus;
};

const lampOfflineBackoff = new Map<string, LampOfflineEntry>();

function clearLampOfflineBackoff(lampId?: string): void {
  if (lampId) lampOfflineBackoff.delete(lampId);
  else lampOfflineBackoff.clear();
}

export type CoverMotion =
  | "open"
  | "closed"
  | "opening"
  | "closing"
  | "stopped"
  | "unknown";

export type CoverDeviceStatus = {
  id: string;
  name: string;
  groupId: string;
  online: boolean;
  state: CoverMotion;
  /** 0 = zu, 100 = auf (Shelly current_pos), null if unknown. */
  positionPct: number | null;
  error?: string;
};

export type PlugDeviceStatus = {
  id: string;
  name: string;
  online: boolean;
  on: boolean | null;
  error?: string;
};

export type LampDeviceStatus = {
  id: string;
  name: string;
  groupId: string;
  online: boolean;
  mode: LightModeOrUnknown;
  /** Current brightness 0–100 when known. */
  brightnessPct: number | null;
  onPercent: number;
  /** Absent when the lamp has no dim_percent in YAML. */
  dimPercent: number | null;
  error?: string;
};

export type SmarthomeGroupStatus = {
  id: string;
  name: string;
  covers: CoverDeviceStatus[];
};

export type SmarthomeLightGroupStatus = {
  id: string;
  name: string;
  mode: LightGroupMode | "unknown";
  lamps: LampDeviceStatus[];
};

export type SmarthomeSnapshot = {
  /** Cover groups only (type: covers). */
  groups: SmarthomeGroupStatus[];
  /** Light groups only (type: lights). */
  lightGroups: SmarthomeLightGroupStatus[];
  plugs: PlugDeviceStatus[];
  fetchedAt: string;
  /** True when any cover is opening/closing — UI can poll faster. */
  anyMoving: boolean;
  configSource: "file" | "example" | "invalid";
  warnings: string[];
};

export type CoverAction = "open" | "stop" | "close";

export type DeviceActionResult = {
  id: string;
  ok: boolean;
  error?: string;
};

export type GroupActionResult = {
  groupId: string;
  action: CoverAction;
  results: DeviceActionResult[];
};

export type CoverActionResult = {
  coverId: string;
  action: CoverAction;
  result: DeviceActionResult;
};

export type PlugActionResult = {
  plugId: string;
  on: boolean;
  result: DeviceActionResult;
};

export type LightCycleResult = {
  lampId: string;
  mode: LightMode;
  result: DeviceActionResult;
};

export type LightGroupCycleResult = {
  groupId: string;
  mode: LightMode;
  results: DeviceActionResult[];
};

type ShellyCoverStatus = {
  state?: string;
  current_pos?: number | null;
};

type ShellySwitchStatus = {
  output?: boolean;
};

function normalizeCoverState(raw: string | undefined): CoverMotion {
  switch (raw) {
    case "open":
    case "closed":
    case "opening":
    case "closing":
    case "stopped":
      return raw;
    default:
      return "unknown";
  }
}

function coverRpcMethod(action: CoverAction): string {
  switch (action) {
    case "open":
      return "Cover.Open";
    case "stop":
      return "Cover.Stop";
    case "close":
      return "Cover.Close";
  }
}

function lampCredentials(lamp: SmarthomeLampConfig): TuyaLightCredentials {
  return {
    ip: lamp.ip,
    deviceId: lamp.deviceId,
    localKey: lamp.localKey,
    protocol: lamp.protocol,
  };
}

async function readCoverStatus(
  cover: SmarthomeCoverConfig,
  groupId: string,
): Promise<CoverDeviceStatus> {
  try {
    const status = await shellyRpc<ShellyCoverStatus>(cover.ip, "Cover.GetStatus", {
      id: cover.coverId,
    });
    const position =
      typeof status.current_pos === "number" && Number.isFinite(status.current_pos)
        ? Math.max(0, Math.min(100, Math.round(status.current_pos)))
        : null;

    return {
      id: cover.id,
      name: cover.name,
      groupId,
      online: true,
      state: normalizeCoverState(status.state),
      positionPct: position,
    };
  } catch (error) {
    return {
      id: cover.id,
      name: cover.name,
      groupId,
      online: false,
      state: "unknown",
      positionPct: null,
      error:
        error instanceof ShellyRpcError
          ? error.message
          : error instanceof Error
            ? error.message
            : "Cover nicht erreichbar",
    };
  }
}

function plugErrorMessage(error: unknown): string {
  if (error instanceof ShellyRpcError || error instanceof TapoPlugError) {
    return error.message;
  }
  if (error instanceof Error) return error.message;
  return "Plug nicht erreichbar";
}

function lampErrorMessage(error: unknown): string {
  if (error instanceof TuyaLightError) return error.message;
  if (error instanceof Error) return error.message;
  return "Lampe nicht erreichbar";
}

async function readPlugStatus(
  plug: SmarthomePlugConfig,
): Promise<PlugDeviceStatus> {
  try {
    if (plug.vendor === "tapo") {
      const on = await getTapoPlugOn(plug.ip);
      return { id: plug.id, name: plug.name, online: true, on };
    }

    const status = await shellyRpc<ShellySwitchStatus>(
      plug.ip,
      "Switch.GetStatus",
      { id: plug.switchId },
    );
    return {
      id: plug.id,
      name: plug.name,
      online: true,
      on: typeof status.output === "boolean" ? status.output : null,
    };
  } catch (error) {
    return {
      id: plug.id,
      name: plug.name,
      online: false,
      on: null,
      error: plugErrorMessage(error),
    };
  }
}

async function readLampStatus(
  lamp: SmarthomeLampConfig,
): Promise<LampDeviceStatus> {
  const backoff = lampOfflineBackoff.get(lamp.id);
  if (backoff && backoff.until > Date.now()) {
    return backoff.status;
  }

  try {
    const state = await getTuyaLightState(lampCredentials(lamp));
    const mode = classifyLightMode(
      state.on,
      state.brightnessPct,
      lamp.onPercent,
      lamp.dimPercent,
    );
    lampOfflineBackoff.delete(lamp.id);
    return {
      id: lamp.id,
      name: lamp.name,
      groupId: lamp.groupId,
      online: true,
      mode,
      brightnessPct: state.on ? state.brightnessPct : 0,
      onPercent: lamp.onPercent,
      dimPercent: lamp.dimPercent ?? null,
    };
  } catch (error) {
    const status: LampDeviceStatus = {
      id: lamp.id,
      name: lamp.name,
      groupId: lamp.groupId,
      online: false,
      mode: "unknown",
      brightnessPct: null,
      onPercent: lamp.onPercent,
      dimPercent: lamp.dimPercent ?? null,
      error: lampErrorMessage(error),
    };
    lampOfflineBackoff.set(lamp.id, {
      until: Date.now() + LAMP_OFFLINE_BACKOFF_MS,
      status,
    });
    return status;
  }
}

function buildLightGroupStatus(
  id: string,
  name: string,
  lamps: LampDeviceStatus[],
): SmarthomeLightGroupStatus {
  return {
    id,
    name,
    mode: summarizeLightGroupModes(
      lamps.map((l) => ({ mode: l.mode, dimPercent: l.dimPercent })),
    ),
    lamps,
  };
}

async function loadSnapshot(config: SmarthomeConfig): Promise<{
  groups: SmarthomeGroupStatus[];
  lightGroups: SmarthomeLightGroupStatus[];
  plugs: PlugDeviceStatus[];
}> {
  const coverGroupPromises = coverGroups(config).map(async (group) => {
    const covers = await Promise.all(
      group.covers.map((cover) => readCoverStatus(cover, group.id)),
    );
    return { id: group.id, name: group.name, covers };
  });

  const lightGroupPromises = lightGroups(config).map(async (group) => {
    const lamps = await Promise.all(group.lamps.map((lamp) => readLampStatus(lamp)));
    return buildLightGroupStatus(group.id, group.name, lamps);
  });

  const [groups, lightGroupStatuses, plugs] = await Promise.all([
    Promise.all(coverGroupPromises),
    Promise.all(lightGroupPromises),
    Promise.all(visiblePlugs(config).map((plug) => readPlugStatus(plug))),
  ]);

  return { groups, lightGroups: lightGroupStatuses, plugs };
}

export function invalidateSmarthomeStatusCache(): void {
  cacheDelete(STATUS_CACHE_KEY);
}

function requireLiveConfig(): SmarthomeConfig {
  const loaded = getSmarthomeConfig();
  if (!loaded.ok) {
    throw new Error(loaded.error);
  }
  if (loaded.source === "example") {
    throw new Error(
      "Keine Live-Config (config/smarthome.yml) — Steuerbefehle deaktiviert",
    );
  }
  return loaded.config;
}

export async function getSmarthomeSnapshot(
  options: { bypassCache?: boolean } = {},
): Promise<SmarthomeSnapshot> {
  const loaded = getSmarthomeConfig();
  const warnings: string[] = [];
  let configSource: SmarthomeSnapshot["configSource"] = "file";

  if (!loaded.ok) {
    warnings.push(loaded.error);
    configSource = "invalid";
    return {
      groups: [],
      lightGroups: [],
      plugs: [],
      fetchedAt: new Date().toISOString(),
      anyMoving: false,
      configSource,
      warnings,
    };
  }

  if (loaded.source === "example") {
    warnings.push(loaded.warning);
    configSource = "example";
    // Do not probe placeholder IPs — layout only until config/smarthome.yml exists.
    return {
      groups: coverGroups(loaded.config).map((group) => ({
        id: group.id,
        name: group.name,
        covers: group.covers.map((cover) => ({
          id: cover.id,
          name: cover.name,
          groupId: group.id,
          online: false,
          state: "unknown" as const,
          positionPct: null,
          error: "Platzhalter — config/smarthome.yml anlegen",
        })),
      })),
      lightGroups: lightGroups(loaded.config).map((group) =>
        buildLightGroupStatus(
          group.id,
          group.name,
          group.lamps.map((lamp) => ({
            id: lamp.id,
            name: lamp.name,
            groupId: group.id,
            online: false,
            mode: "unknown" as const,
            brightnessPct: null,
            onPercent: lamp.onPercent,
            dimPercent: lamp.dimPercent ?? null,
            error: "Platzhalter — config/smarthome.yml anlegen",
          })),
        ),
      ),
      plugs: visiblePlugs(loaded.config).map((plug) => ({
        id: plug.id,
        name: plug.name,
        online: false,
        on: null,
        error: "Platzhalter — config/smarthome.yml anlegen",
      })),
      fetchedAt: new Date().toISOString(),
      anyMoving: false,
      configSource,
      warnings,
    };
  }

  if (options.bypassCache) {
    invalidateSmarthomeStatusCache();
    clearLampOfflineBackoff();
  }

  // Stale-while-revalidate: serve the last snapshot immediately while a
  // background refresh runs, so opening the tab is not blocked by Tuya timeouts.
  const stale = cacheGetStale<{
    groups: SmarthomeGroupStatus[];
    lightGroups: SmarthomeLightGroupStatus[];
    plugs: PlugDeviceStatus[];
  }>(STATUS_CACHE_KEY);

  if (!options.bypassCache && stale && !cacheHasFresh(STATUS_CACHE_KEY)) {
    void cacheGetOrSet(STATUS_CACHE_KEY, CACHE_TTL.smarthome, () =>
      loadSnapshot(loaded.config),
    ).catch(() => undefined);
    const anyMoving = stale.groups.some((g) =>
      g.covers.some((c) => c.state === "opening" || c.state === "closing"),
    );
    return {
      ...stale,
      fetchedAt: new Date().toISOString(),
      anyMoving,
      configSource,
      warnings,
    };
  }

  const { groups, lightGroups: lightGroupStatuses, plugs } = await cacheGetOrSet(
    STATUS_CACHE_KEY,
    CACHE_TTL.smarthome,
    () => loadSnapshot(loaded.config),
  );

  const anyMoving = groups.some((g) =>
    g.covers.some((c) => c.state === "opening" || c.state === "closing"),
  );

  return {
    groups,
    lightGroups: lightGroupStatuses,
    plugs,
    fetchedAt: new Date().toISOString(),
    anyMoving,
    configSource,
    warnings,
  };
}

async function runCoverAction(
  cover: SmarthomeCoverConfig,
  action: CoverAction,
): Promise<DeviceActionResult> {
  try {
    await shellyRpc(cover.ip, coverRpcMethod(action), { id: cover.coverId });
    return { id: cover.id, ok: true };
  } catch (error) {
    return {
      id: cover.id,
      ok: false,
      error:
        error instanceof Error ? error.message : "Cover-Befehl fehlgeschlagen",
    };
  }
}

export async function runGroupCoverAction(
  groupId: string,
  action: CoverAction,
): Promise<GroupActionResult> {
  const config = requireLiveConfig();
  const group = findCoverGroup(config, groupId);
  if (!group) {
    throw new Error(`Unbekannte Cover-Gruppe: ${groupId}`);
  }
  // "stop" must always get through to halt a moving shutter.
  if (action !== "stop") {
    takeControlSlot(group.covers.map((cover) => `cover:${cover.id}`));
  }

  const results = await Promise.all(
    group.covers.map((cover) => runCoverAction(cover, action)),
  );
  invalidateSmarthomeStatusCache();
  return { groupId, action, results };
}

export async function runSingleCoverAction(
  coverId: string,
  action: CoverAction,
): Promise<CoverActionResult> {
  const config = requireLiveConfig();
  const cover = findCover(config, coverId);
  if (!cover) {
    throw new Error(`Unbekanntes Rollo: ${coverId}`);
  }
  if (action !== "stop") takeControlSlot([`cover:${cover.id}`]);

  const result = await runCoverAction(cover, action);
  invalidateSmarthomeStatusCache();
  return { coverId, action, result };
}

export async function runPlugSet(
  plugId: string,
  on: boolean,
): Promise<PlugActionResult> {
  const config = requireLiveConfig();
  const plug = findPlug(config, plugId);
  if (!plug) {
    throw new Error(`Unbekannter Plug: ${plugId}`);
  }
  takeControlSlot([`plug:${plug.id}`]);

  try {
    if (plug.vendor === "tapo") {
      await setTapoPlugOn(plug.ip, on);
    } else {
      await shellyRpc(plug.ip, "Switch.Set", { id: plug.switchId, on });
    }
    invalidateSmarthomeStatusCache();
    return { plugId, on, result: { id: plug.id, ok: true } };
  } catch (error) {
    invalidateSmarthomeStatusCache();
    return {
      plugId,
      on,
      result: {
        id: plug.id,
        ok: false,
        error: plugErrorMessage(error),
      },
    };
  }
}

async function applyLampMode(
  lamp: SmarthomeLampConfig,
  mode: LightMode,
): Promise<DeviceActionResult> {
  clearLampOfflineBackoff(lamp.id);
  try {
    await setTuyaLightMode(
      lampCredentials(lamp),
      mode,
      lamp.onPercent,
      lamp.dimPercent,
    );
    clearLampOfflineBackoff(lamp.id);
    return { id: lamp.id, ok: true };
  } catch (error) {
    return {
      id: lamp.id,
      ok: false,
      error: lampErrorMessage(error),
    };
  }
}

/**
 * Resolve current mode for cycling. Prefer a fresh device read; fall back to
 * last snapshot classification if the read fails (still attempt the command).
 */
async function resolveLampCycleMode(
  lamp: SmarthomeLampConfig,
): Promise<LightModeOrUnknown> {
  // Always probe on control — don't let status backoff skip the read.
  clearLampOfflineBackoff(lamp.id);
  try {
    const state = await getTuyaLightState(lampCredentials(lamp));
    return classifyLightMode(
      state.on,
      state.brightnessPct,
      lamp.onPercent,
      lamp.dimPercent,
    );
  } catch {
    return "unknown";
  }
}

export async function runLampCycle(lampId: string): Promise<LightCycleResult> {
  const config = requireLiveConfig();
  const lamp = findLamp(config, lampId);
  if (!lamp) {
    throw new Error(`Unbekannte Lampe: ${lampId}`);
  }
  takeControlSlot([`lamp:${lamp.id}`]);

  const current = await resolveLampCycleMode(lamp);
  const mode = nextLightMode(current, lamp.dimPercent !== undefined);
  const result = await applyLampMode(lamp, mode);
  invalidateSmarthomeStatusCache();
  // Report the effective mode for this lamp (dim without target → off).
  const effective: LightMode =
    mode === "dim" && lamp.dimPercent === undefined ? "off" : mode;
  return { lampId, mode: effective, result };
}

export async function runLightGroupCycle(
  groupId: string,
): Promise<LightGroupCycleResult> {
  const config = requireLiveConfig();
  const group = findLightGroup(config, groupId);
  if (!group) {
    throw new Error(`Unbekannte Lampen-Gruppe: ${groupId}`);
  }
  takeControlSlot(group.lamps.map((lamp) => `lamp:${lamp.id}`));

  const modes = await Promise.all(
    group.lamps.map((lamp) => resolveLampCycleMode(lamp)),
  );
  const groupMode = summarizeLightGroupModes(
    group.lamps.map((lamp, i) => ({
      mode: modes[i] ?? "unknown",
      dimPercent: lamp.dimPercent,
    })),
  );
  const mode = nextLightMode(groupMode);

  const results = await Promise.all(
    group.lamps.map((lamp) => applyLampMode(lamp, mode)),
  );
  invalidateSmarthomeStatusCache();
  return { groupId, mode, results };
}

export function isCoverAction(value: unknown): value is CoverAction {
  return value === "open" || value === "stop" || value === "close";
}
