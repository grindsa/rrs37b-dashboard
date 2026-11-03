import { cacheDelete, cacheGetOrSet, CACHE_TTL } from "./cache";
import { shellyRpc, ShellyRpcError } from "./shelly-rpc";
import { takeControlSlot } from "./control-throttle";
import {
  findCover,
  findGroup,
  findPlug,
  getSmarthomeConfig,
  visiblePlugs,
  type SmarthomeConfig,
  type SmarthomeCoverConfig,
  type SmarthomePlugConfig,
} from "./smarthome-config";

const STATUS_CACHE_KEY = "smarthome:status";

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

export type SmarthomeGroupStatus = {
  id: string;
  name: string;
  covers: CoverDeviceStatus[];
};

export type SmarthomeSnapshot = {
  groups: SmarthomeGroupStatus[];
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

async function readPlugStatus(
  plug: SmarthomePlugConfig,
): Promise<PlugDeviceStatus> {
  try {
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
      error:
        error instanceof ShellyRpcError
          ? error.message
          : error instanceof Error
            ? error.message
            : "Plug nicht erreichbar",
    };
  }
}

async function loadSnapshot(config: SmarthomeConfig): Promise<{
  groups: SmarthomeGroupStatus[];
  plugs: PlugDeviceStatus[];
}> {
  const groupPromises = config.groups.map(async (group) => {
    const covers = await Promise.all(
      group.covers.map((cover) => readCoverStatus(cover, group.id)),
    );
    return { id: group.id, name: group.name, covers };
  });

  const [groups, plugs] = await Promise.all([
    Promise.all(groupPromises),
    Promise.all(visiblePlugs(config).map((plug) => readPlugStatus(plug))),
  ]);

  return { groups, plugs };
}

export function invalidateSmarthomeStatusCache(): void {
  cacheDelete(STATUS_CACHE_KEY);
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
      groups: loaded.config.groups.map((group) => ({
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
  }

  const { groups, plugs } = await cacheGetOrSet(
    STATUS_CACHE_KEY,
    CACHE_TTL.smarthome,
    () => loadSnapshot(loaded.config),
  );

  const anyMoving = groups.some((g) =>
    g.covers.some((c) => c.state === "opening" || c.state === "closing"),
  );

  return {
    groups,
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
  const loaded = getSmarthomeConfig();
  if (!loaded.ok) {
    throw new Error(loaded.error);
  }
  if (loaded.source === "example") {
    throw new Error(
      "Keine Live-Config (config/smarthome.yml) — Steuerbefehle deaktiviert",
    );
  }

  const group = findGroup(loaded.config, groupId);
  if (!group) {
    throw new Error(`Unbekannte Gruppe: ${groupId}`);
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
  const loaded = getSmarthomeConfig();
  if (!loaded.ok) {
    throw new Error(loaded.error);
  }
  if (loaded.source === "example") {
    throw new Error(
      "Keine Live-Config (config/smarthome.yml) — Steuerbefehle deaktiviert",
    );
  }

  const cover = findCover(loaded.config, coverId);
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
  const loaded = getSmarthomeConfig();
  if (!loaded.ok) {
    throw new Error(loaded.error);
  }
  if (loaded.source === "example") {
    throw new Error(
      "Keine Live-Config (config/smarthome.yml) — Steuerbefehle deaktiviert",
    );
  }

  const plug = findPlug(loaded.config, plugId);
  if (!plug) {
    throw new Error(`Unbekannter Plug: ${plugId}`);
  }
  takeControlSlot([`plug:${plug.id}`]);

  try {
    await shellyRpc(plug.ip, "Switch.Set", { id: plug.switchId, on });
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
        error:
          error instanceof Error ? error.message : "Plug-Befehl fehlgeschlagen",
      },
    };
  }
}

export function isCoverAction(value: unknown): value is CoverAction {
  return value === "open" || value === "stop" || value === "close";
}
