/**
 * Smarthome device layout from a YAML file.
 * Display names and grouping are configurable; device identity is IP + component id.
 * RPC password remains in env (SHELLY_RPC_PASSWORD).
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";

export type SmarthomeCoverConfig = {
  id: string;
  name: string;
  ip: string;
  /** Shelly Cover component id (usually 0). */
  coverId: number;
};

export type SmarthomeGroupConfig = {
  id: string;
  name: string;
  covers: SmarthomeCoverConfig[];
};

export type SmarthomePlugConfig = {
  id: string;
  name: string;
  ip: string;
  /** Shelly Switch component id (usually 0). */
  switchId: number;
};

export type SmarthomeConfig = {
  groups: SmarthomeGroupConfig[];
  plugs: SmarthomePlugConfig[];
};

const ERR_PREFIX = "Smarthome-Config";

const DEFAULT_CONFIG_FILE = "config/smarthome.yml";
const EXAMPLE_CONFIG_FILE = "config/smarthome.example.yml";

const IPV4_RE =
  /^(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)$/;

function asRecord(value: unknown, pathLabel: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${ERR_PREFIX}: ${pathLabel} must be an object`);
  }
  return value as Record<string, unknown>;
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

function parseCover(raw: unknown, pathLabel: string): SmarthomeCoverConfig {
  const obj = asRecord(raw, pathLabel);
  return {
    id: asString(obj.id, `${pathLabel}.id`),
    name: asString(obj.name, `${pathLabel}.name`),
    ip: asIp(obj.ip, `${pathLabel}.ip`),
    coverId: asComponentId(obj.coverId, `${pathLabel}.coverId`),
  };
}

function parseGroup(raw: unknown, pathLabel: string): SmarthomeGroupConfig {
  const obj = asRecord(raw, pathLabel);
  if (!Array.isArray(obj.covers)) {
    throw new Error(`${ERR_PREFIX}: ${pathLabel}.covers must be an array`);
  }
  return {
    id: asString(obj.id, `${pathLabel}.id`),
    name: asString(obj.name, `${pathLabel}.name`),
    covers: obj.covers.map((c, i) =>
      parseCover(c, `${pathLabel}.covers[${i}]`),
    ),
  };
}

function parsePlug(raw: unknown, pathLabel: string): SmarthomePlugConfig {
  const obj = asRecord(raw, pathLabel);
  return {
    id: asString(obj.id, `${pathLabel}.id`),
    name: asString(obj.name, `${pathLabel}.name`),
    ip: asIp(obj.ip, `${pathLabel}.ip`),
    switchId: asComponentId(obj.switchId, `${pathLabel}.switchId`),
  };
}

function assertUniqueIds(config: SmarthomeConfig): void {
  const seen = new Set<string>();
  const claim = (id: string, kind: string) => {
    if (seen.has(id)) {
      throw new Error(`${ERR_PREFIX}: duplicate ${kind} id "${id}"`);
    }
    seen.add(id);
  };

  for (const group of config.groups) {
    claim(`group:${group.id}`, "group");
    for (const cover of group.covers) {
      claim(`cover:${cover.id}`, "cover");
    }
  }
  for (const plug of config.plugs) {
    claim(`plug:${plug.id}`, "plug");
  }
}

export function parseSmarthomeConfigData(parsed: unknown): SmarthomeConfig {
  const root = asRecord(parsed, "root");
  if (!Array.isArray(root.groups)) {
    throw new Error(`${ERR_PREFIX}: groups must be an array`);
  }
  const plugsRaw = root.plugs === undefined ? [] : root.plugs;
  if (!Array.isArray(plugsRaw)) {
    throw new Error(`${ERR_PREFIX}: plugs must be an array`);
  }

  const config: SmarthomeConfig = {
    groups: root.groups.map((g, i) => parseGroup(g, `groups[${i}]`)),
    plugs: plugsRaw.map((p, i) => parsePlug(p, `plugs[${i}]`)),
  };
  assertUniqueIds(config);
  return config;
}

export function parseSmarthomeConfigYaml(raw: string): SmarthomeConfig {
  let parsed: unknown;
  try {
    parsed = parseYaml(raw);
  } catch (error) {
    throw new Error(
      `${ERR_PREFIX}: invalid YAML (${error instanceof Error ? error.message : "parse error"})`,
    );
  }
  if (parsed === null || parsed === undefined) {
    throw new Error(`${ERR_PREFIX}: file is empty`);
  }
  return parseSmarthomeConfigData(parsed);
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

function readYamlFile(filePath: string): SmarthomeConfig {
  const raw = readFileSync(filePath, "utf8");
  return parseSmarthomeConfigYaml(raw);
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
        config: readYamlFile(livePath),
        source: "file",
        path: livePath,
      };
    } catch (error) {
      return {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : `${ERR_PREFIX}: Datei ungültig (${livePath})`,
        config: { groups: [], plugs: [] },
      };
    }
  }

  const examplePath = getSmarthomeExampleConfigFilePath();
  if (existsSync(examplePath)) {
    try {
      return {
        ok: true,
        config: readYamlFile(examplePath),
        source: "example",
        path: examplePath,
        warning: `Keine Live-Config unter ${livePath} — Beispiel-Layout (Steuerung aus)`,
      };
    } catch (error) {
      return {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : `${ERR_PREFIX}: Beispiel-Datei ungültig`,
        config: { groups: [], plugs: [] },
      };
    }
  }

  return {
    ok: false,
    error: `${ERR_PREFIX}: weder ${livePath} noch ${examplePath} gefunden`,
    config: { groups: [], plugs: [] },
  };
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

export function findPlug(
  config: SmarthomeConfig,
  plugId: string,
): SmarthomePlugConfig | undefined {
  return config.plugs.find((p) => p.id === plugId);
}
