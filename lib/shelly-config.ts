export type SensorLabel = "Aussen" | "Arbeitszimmer" | "Wohnzimmer";

export type SensorBinding = {
  label: SensorLabel;
  /** Gateway Plug IP that should see this BLU device. */
  gatewayIp: string;
  /** Optional BLU MAC (aa:bb:…); required for reliable mapping once paired. */
  mac?: string;
};

function normalizeMac(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const cleaned = value.trim().toLowerCase().replace(/-/g, ":");
  if (!/^([0-9a-f]{2}:){5}[0-9a-f]{2}$/.test(cleaned)) {
    throw new Error(`Invalid Shelly sensor MAC: ${value}`);
  }
  return cleaned;
}

function requireIp(name: string, value: string | undefined): string {
  const ip = value?.trim();
  if (!ip) throw new Error(`Missing env ${name}`);
  return ip;
}

export function getShellyBindings(): SensorBinding[] {
  const aussenArbeit = requireIp(
    "SHELLY_PLUG_AUSSEN_ARBEIT",
    process.env.SHELLY_PLUG_AUSSEN_ARBEIT,
  );
  const wohnzimmer = requireIp(
    "SHELLY_PLUG_WOHNZIMMER",
    process.env.SHELLY_PLUG_WOHNZIMMER,
  );

  return [
    {
      label: "Aussen",
      gatewayIp: aussenArbeit,
      mac: normalizeMac(process.env.SHELLY_SENSOR_AUSSEN),
    },
    {
      label: "Arbeitszimmer",
      gatewayIp: aussenArbeit,
      mac: normalizeMac(process.env.SHELLY_SENSOR_ARBEITSZIMMER),
    },
    {
      label: "Wohnzimmer",
      gatewayIp: wohnzimmer,
      mac: normalizeMac(process.env.SHELLY_SENSOR_WOHNZIMMER),
    },
  ];
}

export function getShellyRpcPassword(): string | undefined {
  const password = process.env.SHELLY_RPC_PASSWORD?.trim();
  return password ? password : undefined;
}

export function uniqueGatewayIps(bindings: SensorBinding[]): string[] {
  return [...new Set(bindings.map((b) => b.gatewayIp))];
}
