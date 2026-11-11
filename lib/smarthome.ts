import {
  cacheDelete,
  cacheGetOrSet,
  cacheGetStale,
  cacheHasFresh,
  CACHE_TTL,
} from "./cache";
import { shellyRpc, ShellyRpcError } from "./shelly-rpc";
import { takeControlSlot } from "./control-throttle";
import {
  getFsapiPowerOn,
  getFsapiVolume,
  getFsapiVolumeMax,
  nudgeFsapiVolume,
  setFsapiPowerOn,
  FsapiError,
} from "./fsapi";
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
  isGiraCover,
  lightGroups,
  visiblePlugs,
  type PlugVendor,
  type SmarthomeConfig,
  type SmarthomeCoverConfig,
  type SmarthomeGiraCoverConfig,
  type SmarthomeLampConfig,
  type SmarthomePlugConfig,
  type SmarthomeShellyCoverConfig,
} from "./smarthome-config";
import {
  commandGiraCover,
  GiraBleError,
  isGiraBleConfigured,
  listGiraCovers,
  type GiraCover,
  type GiraCoverAction,
} from "./gira-ble";

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
  /** shelly (LAN) or gira (BLE proxy). */
  vendor: "shelly" | "gira";
  online: boolean;
  state: CoverMotion;
  /** 0 = zu, 100 = auf (Shelly / gira-ble-api), null if unknown. */
  positionPct: number | null;
  /** Gira bond status; absent for Shelly. */
  paired?: boolean | null;
  error?: string;
};

export type PlugDeviceStatus = {
  id: string;
  name: string;
  vendor: PlugVendor;
  online: boolean;
  on: boolean | null;
  error?: string;
  /** FSAPI radios — absolute volume when known. */
  volume?: number | null;
  /** FSAPI radios — max volume index (volumeSteps − 1). */
  volumeMax?: number | null;
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
  /** Cover with no YAML `group` — group-level controls only, no expand. */
  standalone: boolean;
  covers: CoverDeviceStatus[];
};

export type SmarthomeLightGroupStatus = {
  id: string;
  name: string;
  mode: LightGroupMode | "unknown";
  lamps: LampDeviceStatus[];
};

export type SmarthomeSnapshot = {
  /** Groups with at least one cover. */
  groups: SmarthomeGroupStatus[];
  /** Groups with at least one lamp. */
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

export type PlugVolumeActionResult = {
  plugId: string;
  volume: number;
  volumeMax: number;
  on: boolean | null;
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

function coverActionToGira(action: CoverAction): GiraCoverAction {
  switch (action) {
    case "open":
      return "up";
    case "close":
      return "down";
    case "stop":
      return "stop";
  }
}

function giraCoverMotion(positionPct: number | null): CoverMotion {
  if (positionPct === null) return "unknown";
  if (positionPct >= 100) return "open";
  if (positionPct <= 0) return "closed";
  return "stopped";
}

function giraCoverErrorMessage(code: string | undefined, fallback: string): string {
  switch (code) {
    case "ble_timeout":
    case "timeout":
      return "BLE-Timeout — Rollo antwortet nicht";
    case "not_paired":
      return "Nicht gekoppelt";
    case "ble_error":
      return "BLE-Fehler";
    case "ble_disabled":
      return "BLE deaktiviert am Proxy";
    case "not_found":
      return "Rollo nicht am Proxy gefunden";
    case "unauthorized":
      return "Proxy-Auth fehlgeschlagen";
    case "not_configured":
      return "GIRA_BLE_API_URL nicht gesetzt";
    case "unreachable":
      return "Gira-Proxy nicht erreichbar";
    default:
      return fallback || "Rollo nicht erreichbar";
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

async function readShellyCoverStatus(
  cover: SmarthomeShellyCoverConfig,
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
      vendor: "shelly",
      online: true,
      state: normalizeCoverState(status.state),
      positionPct: position,
    };
  } catch (error) {
    return {
      id: cover.id,
      name: cover.name,
      groupId,
      vendor: "shelly",
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

function giraCoverToStatus(
  cover: SmarthomeGiraCoverConfig,
  groupId: string,
  live: GiraCover | undefined,
  listError?: string,
): CoverDeviceStatus {
  if (!isGiraBleConfigured()) {
    return {
      id: cover.id,
      name: cover.name,
      groupId,
      vendor: "gira",
      online: false,
      state: "unknown",
      positionPct: null,
      paired: null,
      error: "GIRA_BLE_API_URL nicht gesetzt",
    };
  }

  if (listError) {
    return {
      id: cover.id,
      name: cover.name,
      groupId,
      vendor: "gira",
      online: false,
      state: "unknown",
      positionPct: null,
      paired: null,
      error: listError,
    };
  }

  if (!live) {
    return {
      id: cover.id,
      name: cover.name,
      groupId,
      vendor: "gira",
      online: false,
      state: "unknown",
      positionPct: null,
      paired: null,
      error: "Nicht am Gira-Proxy gefunden",
    };
  }

  if (live.paired === false) {
    return {
      id: cover.id,
      name: cover.name,
      groupId,
      vendor: "gira",
      online: false,
      state: "unknown",
      positionPct: live.position_pct,
      paired: false,
      error: live.error ?? "Nicht gekoppelt",
    };
  }

  const online = live.online;
  return {
    id: cover.id,
    name: cover.name,
    groupId,
    vendor: "gira",
    online,
    state: online ? giraCoverMotion(live.position_pct) : "unknown",
    positionPct: live.position_pct,
    paired: live.paired,
    ...(live.error
      ? { error: live.error }
      : online
        ? {}
        : { error: "offline" }),
  };
}

function plugErrorMessage(error: unknown): string {
  if (
    error instanceof ShellyRpcError ||
    error instanceof TapoPlugError ||
    error instanceof FsapiError
  ) {
    return error.message;
  }
  if (error instanceof Error) return error.message;
  return "Plug nicht erreichbar";
}

function fsapiTarget(plug: SmarthomePlugConfig) {
  return { ip: plug.ip, pin: plug.pin, port: plug.port };
}

async function readFsapiVolumeFields(
  plug: SmarthomePlugConfig,
): Promise<{ volume: number | null; volumeMax: number | null }> {
  try {
    const [volume, volumeMax] = await Promise.all([
      getFsapiVolume(fsapiTarget(plug)),
      getFsapiVolumeMax(fsapiTarget(plug)),
    ]);
    return { volume, volumeMax };
  } catch {
    return { volume: null, volumeMax: null };
  }
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
      return {
        id: plug.id,
        name: plug.name,
        vendor: plug.vendor,
        online: true,
        on,
      };
    }

    if (plug.vendor === "fsapi") {
      const on = await getFsapiPowerOn(fsapiTarget(plug));
      const { volume, volumeMax } = await readFsapiVolumeFields(plug);
      return {
        id: plug.id,
        name: plug.name,
        vendor: "fsapi",
        online: true,
        on,
        volume,
        volumeMax,
      };
    }

    const status = await shellyRpc<ShellySwitchStatus>(
      plug.ip,
      "Switch.GetStatus",
      { id: plug.switchId },
    );
    return {
      id: plug.id,
      name: plug.name,
      vendor: plug.vendor,
      online: true,
      on: typeof status.output === "boolean" ? status.output : null,
    };
  } catch (error) {
    return {
      id: plug.id,
      name: plug.name,
      vendor: plug.vendor,
      online: false,
      on: null,
      error: plugErrorMessage(error),
      ...(plug.vendor === "fsapi"
        ? { volume: null, volumeMax: null }
        : {}),
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

async function loadGiraCoverMap(
  config: SmarthomeConfig,
): Promise<{ byId: Map<string, GiraCover>; listError?: string }> {
  const needsGira = coverGroups(config).some((g) =>
    g.covers.some((c) => isGiraCover(c)),
  );
  if (!needsGira) return { byId: new Map() };
  if (!isGiraBleConfigured()) return { byId: new Map() };

  try {
    const list = await listGiraCovers();
    return { byId: new Map(list.map((c) => [c.id, c])) };
  } catch (error) {
    const listError =
      error instanceof GiraBleError
        ? giraCoverErrorMessage(error.code, error.message)
        : error instanceof Error
          ? error.message
          : "Gira-Proxy nicht erreichbar";
    return { byId: new Map(), listError };
  }
}

async function loadSnapshot(config: SmarthomeConfig): Promise<{
  groups: SmarthomeGroupStatus[];
  lightGroups: SmarthomeLightGroupStatus[];
  plugs: PlugDeviceStatus[];
}> {
  const giraPromise = loadGiraCoverMap(config);

  const lightGroupPromises = lightGroups(config).map(async (group) => {
    const lamps = await Promise.all(group.lamps.map((lamp) => readLampStatus(lamp)));
    return buildLightGroupStatus(group.id, group.name, lamps);
  });

  const [gira, lightGroupStatuses, plugs] = await Promise.all([
    giraPromise,
    Promise.all(lightGroupPromises),
    Promise.all(visiblePlugs(config).map((plug) => readPlugStatus(plug))),
  ]);

  const groups = await Promise.all(
    coverGroups(config).map(async (group) => {
      const covers = await Promise.all(
        group.covers.map((cover) => {
          if (isGiraCover(cover)) {
            return giraCoverToStatus(
              cover,
              group.id,
              gira.byId.get(cover.id),
              gira.listError,
            );
          }
          return readShellyCoverStatus(cover, group.id);
        }),
      );
      return {
        id: group.id,
        name: group.name,
        standalone: group.standalone,
        covers,
      };
    }),
  );

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
        standalone: group.standalone,
        covers: group.covers.map((cover) => ({
          id: cover.id,
          name: cover.name,
          groupId: group.id,
          vendor: cover.vendor,
          online: false,
          state: "unknown" as const,
          positionPct: null,
          ...(isGiraCover(cover) ? { paired: null as boolean | null } : {}),
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
        vendor: plug.vendor,
        online: false,
        on: null,
        error: "Platzhalter — config/smarthome.yml anlegen",
        ...(plug.vendor === "fsapi"
          ? { volume: null, volumeMax: null }
          : {}),
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
    if (isGiraCover(cover)) {
      if (!isGiraBleConfigured()) {
        return {
          id: cover.id,
          ok: false,
          error: "GIRA_BLE_API_URL nicht gesetzt",
        };
      }
      await commandGiraCover(cover.id, coverActionToGira(action));
      return { id: cover.id, ok: true };
    }
    await shellyRpc(cover.ip, coverRpcMethod(action), { id: cover.coverId });
    return { id: cover.id, ok: true };
  } catch (error) {
    return {
      id: cover.id,
      ok: false,
      error:
        error instanceof GiraBleError
          ? giraCoverErrorMessage(error.code, error.message)
          : error instanceof Error
            ? error.message
            : "Cover-Befehl fehlgeschlagen",
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
    } else if (plug.vendor === "fsapi") {
      await setFsapiPowerOn(fsapiTarget(plug), on);
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

export async function runPlugVolumeNudge(
  plugId: string,
  delta: 1 | -1,
): Promise<PlugVolumeActionResult> {
  const config = requireLiveConfig();
  const plug = findPlug(config, plugId);
  if (!plug) {
    throw new Error(`Unbekannter Plug: ${plugId}`);
  }
  if (plug.vendor !== "fsapi") {
    throw new Error(`Lautstärke nur für FSAPI-Radios (got ${plug.vendor})`);
  }
  takeControlSlot([`plug:${plug.id}:volume`]);

  try {
    const { volume, volumeMax } = await nudgeFsapiVolume(
      fsapiTarget(plug),
      delta,
    );
    let on: boolean | null = null;
    try {
      on = await getFsapiPowerOn(fsapiTarget(plug));
    } catch {
      on = null;
    }
    invalidateSmarthomeStatusCache();
    return {
      plugId,
      volume,
      volumeMax,
      on,
      result: { id: plug.id, ok: true },
    };
  } catch (error) {
    invalidateSmarthomeStatusCache();
    return {
      plugId,
      volume: 0,
      volumeMax: 0,
      on: null,
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
