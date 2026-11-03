/**
 * Smarthome device inventory from a YAML file: cover groups, covers, plugs
 * (Shelly or Tapo), BLU sensors (via Shelly gateway plugs) and energy meters.
 * Shelly devices without `password` use SHELLY_RPC_PASSWORD from env.
 * Tapo plugs use TAPO_EMAIL / TAPO_PASSWORD from env (local KLAP).
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";

export const SENSOR_LABELS = ["Aussen", "Arbeitszimmer", "Wohnzimmer"] as const;
export type SensorLabel = (typeof SENSOR_LABELS)[number];

export type SmarthomeCoverConfig = {
  id: string;
  name: string;
  ip: string;
  /** Shelly Cover component id (usually 0). */
  coverId: number;
  groupId: string;
  password?: string;
};

export type SmarthomeGroupConfig = {
  id: string;
  name: string;
  /** Covers referencing this group, in file order. */
  covers: SmarthomeCoverConfig[];
};

export const PLUG_VENDORS = ["shelly", "tapo"] as const;
export type PlugVendor = (typeof PLUG_VENDORS)[number];

export type SmarthomePlugConfig = {
  id: string;
  name: string;
  ip: string;
  /** shelly (default) or tapo. */
  vendor: PlugVendor;
  /** Shelly Switch component id (usually 0). Ignored for Tapo. */
  switchId: number;
  /** Hidden plugs are never listed or switchable via the API. */
  hidden: boolean;
  /** Shelly RPC password only; ignored for Tapo (use TAPO_* env). */
  password?: string;
};

export type SmarthomeSensorConfig = {
  label: SensorLabel;
  /** Plug id of the BLE gateway that sees this BLU device. */
  gatewayId: string;
  gatewayIp: string;
  /** BLU MAC (aa:bb:…); optional until paired, then required for reliable mapping. */
  mac?: string;
};

export type SmarthomeMeterConfig = {
  id: string;
  ip: string;
  /** Shelly EM component id (usually 0). */
  emId: number;
  password?: string;
};

export type DevicePassword = { password: string; deviceId: string };

export type SmarthomeConfig = {
  /** Only groups with at least one cover. */
  groups: SmarthomeGroupConfig[];
  plugs: SmarthomePlugConfig[];
  sensors: SmarthomeSensorConfig[];
  meters: SmarthomeMeterConfig[];
  /** Explicit per-device passwords keyed by IP. */
  passwordsByIp: ReadonlyMap<string, DevicePassword>;
};

const ERR_PREFIX = "Smarthome-Config";

const DEFAULT_CONFIG_FILE = "config/smarthome.yml";
const EXAMPLE_CONFIG_FILE = "config/smarthome.example.yml";

const IPV4_RE =
  /^(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)$/;
const MAC_RE = /^([0-9a-f]{2}:){5}[0-9a-f]{2}$/;

function emptyConfig(): SmarthomeConfig {
  return {
    groups: [],
    plugs: [],
    sensors: [],
    meters: [],
    passwordsByIp: new Map(),
  };
}

function asRecord(value: unknown, pathLabel: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${ERR_PREFIX}: ${pathLabel} must be an object`);
  }
  return value as Record<string, unknown>;
}

function asArray(value: unknown, pathLabel: string): unknown[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw new Error(`${ERR_PREFIX}: ${pathLabel} must be an array`);
  }
  return value;
}

function asString(value: unknown, pathLabel: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${ERR_PREFIX}: ${pathLabel} must be a non-empty string`);
  }
  return value.trim();
}

function asIp(value: unknown, pathLabel: string): string {
  const ip = asString(value, pathLabel);
  if (!IPV4_RE.test(ip)) {
    throw new Error(`${ERR_PREFIX}: ${pathLabel} must be an IPv4 address`);
  }
  return ip;
}

function asComponentId(value: unknown, pathLabel: string): number {
  if (value === undefined || value === null) return 0;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(n) || n < 0) {
    throw new Error(
      `${ERR_PREFIX}: ${pathLabel} must be a non-negative integer`,
    );
  }
  return n;
}

function asOptionalPassword(
  value: unknown,
  pathLabel: string,
): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") {
    throw new Error(
      `${ERR_PREFIX}: ${pathLabel} must be a quoted string`,
    );
  }
  if (!value) {
    throw new Error(
      `${ERR_PREFIX}: ${pathLabel} is empty — remove it to use SHELLY_RPC_PASSWORD`,
    );
  }
  return value;
}

function asOptionalBoolean(value: unknown, pathLabel: string): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value !== "boolean") {
    throw new Error(`${ERR_PREFIX}: ${pathLabel} must be true or false`);
  }
  return value;
}

function asOptionalMac(value: unknown, pathLabel: string): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const mac = asString(value, pathLabel).toLowerCase().replace(/-/g, ":");
  if (!MAC_RE.test(mac)) {
    throw new Error(`${ERR_PREFIX}: ${pathLabel} must be a MAC (aa:bb:cc:dd:ee:ff)`);
  }
  return mac;
}

function asSensorLabel(value: unknown, pathLabel: string): SensorLabel {
  const label = asString(value, pathLabel);
  const hit = SENSOR_LABELS.find((l) => l === label);
  if (!hit) {
    throw new Error(
      `${ERR_PREFIX}: ${pathLabel} must be one of ${SENSOR_LABELS.join(", ")}`,
    );
  }
  return hit;
}

function assertUnique(ids: string[], kind: string): void {
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) {
      throw new Error(`${ERR_PREFIX}: duplicate ${kind} "${id}"`);
    }
    seen.add(id);
  }
}

function parseGroup(raw: unknown, pathLabel: string) {
  const obj = asRecord(raw, pathLabel);
  if ("covers" in obj) {
    throw new Error(
      `${ERR_PREFIX}: ${pathLabel}.covers is no longer supported — list covers at the top level with \`group: <id>\``,
    );
  }
  return {
    id: asString(obj.id, `${pathLabel}.id`),
    name: asString(obj.name, `${pathLabel}.name`),
  };
}

function parseCover(
  raw: unknown,
  pathLabel: string,
  groupIds: Set<string>,
): SmarthomeCoverConfig {
  const obj = asRecord(raw, pathLabel);
  const groupId = asString(obj.group, `${pathLabel}.group`);
  if (!groupIds.has(groupId)) {
    throw new Error(
      `${ERR_PREFIX}: ${pathLabel}.group "${groupId}" is not defined under groups`,
    );
  }
  return {
    id: asString(obj.id, `${pathLabel}.id`),
    name: asString(obj.name, `${pathLabel}.name`),
    ip: asIp(obj.ip, `${pathLabel}.ip`),
    coverId: asComponentId(obj.coverId, `${pathLabel}.coverId`),
    groupId,
    password: asOptionalPassword(obj.password, `${pathLabel}.password`),
  };
}

function asPlugVendor(value: unknown, pathLabel: string): PlugVendor {
  if (value === undefined || value === null || value === "") return "shelly";
  const vendor = asString(value, pathLabel).toLowerCase();
  if ((PLUG_VENDORS as readonly string[]).includes(vendor)) {
    return vendor as PlugVendor;
  }
  throw new Error(
    `${ERR_PREFIX}: ${pathLabel} must be one of ${PLUG_VENDORS.join(", ")}`,
  );
}

function parsePlug(raw: unknown, pathLabel: string): SmarthomePlugConfig {
  const obj = asRecord(raw, pathLabel);
  const vendor = asPlugVendor(obj.vendor, `${pathLabel}.vendor`);
  const password = asOptionalPassword(obj.password, `${pathLabel}.password`);
  if (vendor === "tapo" && password) {
    throw new Error(
      `${ERR_PREFIX}: ${pathLabel}.password is Shelly-only — Tapo uses TAPO_EMAIL / TAPO_PASSWORD`,
    );
  }
  return {
    id: asString(obj.id, `${pathLabel}.id`),
    name: asString(obj.name, `${pathLabel}.name`),
    ip: asIp(obj.ip, `${pathLabel}.ip`),
    vendor,
    switchId: asComponentId(obj.switchId, `${pathLabel}.switchId`),
    hidden: asOptionalBoolean(obj.hidden, `${pathLabel}.hidden`),
    password,
  };
}

function parseSensor(
  raw: unknown,
  pathLabel: string,
  plugsById: Map<string, SmarthomePlugConfig>,
): SmarthomeSensorConfig {
  const obj = asRecord(raw, pathLabel);
  const gatewayId = asString(obj.gateway, `${pathLabel}.gateway`);
  const gateway = plugsById.get(gatewayId);
  if (!gateway) {
    throw new Error(
      `${ERR_PREFIX}: ${pathLabel}.gateway "${gatewayId}" is not defined under plugs`,
    );
  }
  if (gateway.vendor !== "shelly") {
    throw new Error(
      `${ERR_PREFIX}: ${pathLabel}.gateway "${gatewayId}" must be vendor shelly (got ${gateway.vendor}) — BLU gateways cannot be Tapo`,
    );
  }
  return {
    label: asSensorLabel(obj.label, `${pathLabel}.label`),
    gatewayId,
    gatewayIp: gateway.ip,
    mac: asOptionalMac(obj.mac, `${pathLabel}.mac`),
  };
}

function parseMeter(raw: unknown, pathLabel: string): SmarthomeMeterConfig {
  const obj = asRecord(raw, pathLabel);
  return {
    id: asString(obj.id, `${pathLabel}.id`),
    ip: asIp(obj.ip, `${pathLabel}.ip`),
    emId: asComponentId(obj.emId, `${pathLabel}.emId`),
    password: asOptionalPassword(obj.password, `${pathLabel}.password`),
  };
}

type PasswordDevice = { id: string; ip: string; password?: string };

/** One password per IP; entries without one inherit from a sibling entry on the same IP. */
function buildPasswordMap(devices: PasswordDevice[]): Map<string, DevicePassword> {
  const map = new Map<string, DevicePassword>();
  for (const device of devices) {
    if (!device.password) continue;
    const existing = map.get(device.ip);
    if (existing && existing.password !== device.password) {
      throw new Error(
        `${ERR_PREFIX}: "${existing.deviceId}" and "${device.id}" share an IP but have different passwords`,
      );
    }
    if (!existing) {
      map.set(device.ip, { password: device.password, deviceId: device.id });
    }
  }
  return map;
}

type ParseResult = { config: SmarthomeConfig; notes: string[] };

function parseConfig(parsed: unknown): ParseResult {
  const root = asRecord(parsed, "root");
  if (!Array.isArray(root.groups)) {
    throw new Error(`${ERR_PREFIX}: groups must be an array`);
  }

  const groupDefs = root.groups.map((g, i) => parseGroup(g, `groups[${i}]`));
  assertUnique(groupDefs.map((g) => g.id), "group id");
  const groupIds = new Set(groupDefs.map((g) => g.id));

  const covers = asArray(root.covers, "covers").map((c, i) =>
    parseCover(c, `covers[${i}]`, groupIds),
  );
  assertUnique(covers.map((c) => c.id), "cover id");

  const plugs = asArray(root.plugs, "plugs").map((p, i) =>
    parsePlug(p, `plugs[${i}]`),
  );
  assertUnique(plugs.map((p) => p.id), "plug id");
  const plugsById = new Map(plugs.map((p) => [p.id, p]));

  const sensors = asArray(root.sensors, "sensors").map((s, i) =>
    parseSensor(s, `sensors[${i}]`, plugsById),
  );
  assertUnique(sensors.map((s) => s.label), "sensor label");

  const meters = asArray(root.meters, "meters").map((m, i) =>
    parseMeter(m, `meters[${i}]`),
  );
  assertUnique(meters.map((m) => m.id), "meter id");

  const shellyPasswordDevices: PasswordDevice[] = [
    ...covers,
    ...plugs.filter((p) => p.vendor === "shelly"),
    ...meters,
  ];
  const passwordsByIp = buildPasswordMap(shellyPasswordDevices);

  const notes: string[] = [];
  const groups: SmarthomeGroupConfig[] = [];
  for (const def of groupDefs) {
    const groupCovers = covers.filter((c) => c.groupId === def.id);
    if (groupCovers.length === 0) {
      notes.push(`group "${def.id}" has no covers and is not shown`);
      continue;
    }
    groups.push({ ...def, covers: groupCovers });
  }

  for (const plug of plugs) {
    if (plug.vendor === "tapo" && plug.hidden) {
      notes.push(
        `warning: plug "${plug.id}" is vendor tapo with hidden: true — Tapo plugs cannot be BLU gateways`,
      );
    }
  }

  const usingFallback = shellyPasswordDevices
    .filter((d) => !passwordsByIp.has(d.ip))
    .map((d) => d.id);
  if (usingFallback.length > 0) {
    notes.push(`using SHELLY_RPC_PASSWORD for: ${usingFallback.join(", ")}`);
  }

  const tapoPlugs = plugs.filter((p) => p.vendor === "tapo");
  if (tapoPlugs.length > 0) {
    const email = process.env.TAPO_EMAIL?.trim();
    const password = process.env.TAPO_PASSWORD?.trim();
    if (!email || !password) {
      notes.push(
        `Tapo plugs configured (${tapoPlugs.map((p) => p.id).join(", ")}) but TAPO_EMAIL / TAPO_PASSWORD missing`,
      );
    }
  }

  return {
    config: { groups, plugs, sensors, meters, passwordsByIp },
    notes,
  };
}

export function parseSmarthomeConfigData(parsed: unknown): SmarthomeConfig {
  return parseConfig(parsed).config;
}

function parseYamlText(raw: string): ParseResult {
  let parsed: unknown;
  try {
    parsed = parseYaml(raw);
  } catch (error) {
    // The library message quotes file lines, which may contain passwords.
    console.error(
      `[smarthome-config] invalid YAML: ${error instanceof Error ? error.message : String(error)}`,
    );
    const line = (error as { linePos?: { line: number }[] }).linePos?.[0]?.line;
    throw new Error(
      `${ERR_PREFIX}: invalid YAML${line ? ` (line ${line})` : ""}`,
    );
  }
  if (parsed === null || parsed === undefined) {
    throw new Error(`${ERR_PREFIX}: file is empty`);
  }
  return parseConfig(parsed);
}

export function parseSmarthomeConfigYaml(raw: string): SmarthomeConfig {
  return parseYamlText(raw).config;
}

function resolveConfigPath(filePath: string): string {
  return path.isAbsolute(filePath)
    ? filePath
    : path.resolve(process.cwd(), filePath);
}

/** Live config path (default config/smarthome.yml). */
export function getSmarthomeConfigFilePath(): string {
  const fromEnv = process.env.SMARTHOME_CONFIG_FILE?.trim();
  return resolveConfigPath(fromEnv || DEFAULT_CONFIG_FILE);
}

export function getSmarthomeExampleConfigFilePath(): string {
  return resolveConfigPath(EXAMPLE_CONFIG_FILE);
}

/** Parsed files keyed by path; re-read only when mtime or size changes. */
const fileCache = new Map<
  string,
  { stamp: string; result: ParseResult | { error: Error } }
>();

function readYamlFile(filePath: string, logNotes: boolean): SmarthomeConfig {
  const stat = statSync(filePath);
  const stamp = `${stat.mtimeMs}:${stat.size}`;
  const cached = fileCache.get(filePath);
  if (cached && cached.stamp === stamp) {
    if ("error" in cached.result) throw cached.result.error;
    return cached.result.config;
  }

  try {
    const result = parseYamlText(readFileSync(filePath, "utf8"));
    fileCache.set(filePath, { stamp, result });
    if (logNotes) {
      for (const note of result.notes) {
        console.warn(`[smarthome-config] ${note}`);
      }
    }
    return result.config;
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    fileCache.set(filePath, { stamp, result: { error: err } });
    console.error(`[smarthome-config] ${err.message}`);
    throw err;
  }
}

export type SmarthomeConfigLoad =
  | { ok: true; config: SmarthomeConfig; source: "file"; path: string }
  | {
      ok: true;
      config: SmarthomeConfig;
      source: "example";
      path: string;
      warning: string;
    }
  | { ok: false; error: string; config: SmarthomeConfig };

/**
 * Load layout from YAML. Missing live file falls back to the committed example
 * (UI only; control stays disabled). Invalid YAML is a hard error.
 */
export function getSmarthomeConfig(): SmarthomeConfigLoad {
  const livePath = getSmarthomeConfigFilePath();

  if (existsSync(livePath)) {
    try {
      return {
        ok: true,
        config: readYamlFile(livePath, true),
        source: "file",
        path: livePath,
      };
    } catch (error) {
      return {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : `${ERR_PREFIX}: smarthome.yml ungültig`,
        config: emptyConfig(),
      };
    }
  }

  const examplePath = getSmarthomeExampleConfigFilePath();
  if (existsSync(examplePath)) {
    try {
      return {
        ok: true,
        config: readYamlFile(examplePath, false),
        source: "example",
        path: examplePath,
        warning: "Keine Live-Config (config/smarthome.yml) — Beispiel-Layout (Steuerung aus)",
      };
    } catch (error) {
      return {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : `${ERR_PREFIX}: Beispiel-Datei ungültig`,
        config: emptyConfig(),
      };
    }
  }

  console.error(
    `[smarthome-config] neither ${livePath} nor ${examplePath} found`,
  );
  return {
    ok: false,
    error: `${ERR_PREFIX}: weder smarthome.yml noch smarthome.example.yml gefunden`,
    config: emptyConfig(),
  };
}

/**
 * Live config only — for server-side consumers (sensors, meters, RPC auth)
 * that must never probe the example file's placeholder IPs.
 */
export function getLiveSmarthomeConfig():
  | { ok: true; config: SmarthomeConfig }
  | { ok: false; error: string } {
  const loaded = getSmarthomeConfig();
  if (!loaded.ok) return { ok: false, error: loaded.error };
  if (loaded.source === "example") {
    return {
      ok: false,
      error: "Keine Live-Config (config/smarthome.yml) — Geräte nicht angebunden",
    };
  }
  return { ok: true, config: loaded.config };
}

export function findCover(
  config: SmarthomeConfig,
  coverId: string,
): SmarthomeCoverConfig | undefined {
  for (const group of config.groups) {
    const hit = group.covers.find((c) => c.id === coverId);
    if (hit) return hit;
  }
  return undefined;
}

export function findGroup(
  config: SmarthomeConfig,
  groupId: string,
): SmarthomeGroupConfig | undefined {
  return config.groups.find((g) => g.id === groupId);
}

/** Visible plugs only; hidden plugs are not switchable. */
export function findPlug(
  config: SmarthomeConfig,
  plugId: string,
): SmarthomePlugConfig | undefined {
  return config.plugs.find((p) => p.id === plugId && !p.hidden);
}

export function visiblePlugs(config: SmarthomeConfig): SmarthomePlugConfig[] {
  return config.plugs.filter((p) => !p.hidden);
}
