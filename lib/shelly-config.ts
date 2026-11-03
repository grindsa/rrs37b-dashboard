import {
  getLiveSmarthomeConfig,
  type SensorLabel,
} from "./smarthome-config";

export type { SensorLabel };

export type SensorBinding = {
  label: SensorLabel;
  /** Gateway plug id from smarthome.yml; safe to show in client warnings. */
  gatewayId: string;
  /** Gateway Plug IP that should see this BLU device. */
  gatewayIp: string;
  /** Optional BLU MAC (aa:bb:…); required for reliable mapping once paired. */
  mac?: string;
};

/** Sensor → gateway mapping from the `sensors` section of smarthome.yml. */
export function getShellyBindings(): SensorBinding[] {
  const live = getLiveSmarthomeConfig();
  if (!live.ok) throw new Error(live.error);
  if (live.config.sensors.length === 0) {
    throw new Error("Keine Sensoren unter sensors in config/smarthome.yml");
  }
  return live.config.sensors.map(({ label, gatewayId, gatewayIp, mac }) => ({
    label,
    gatewayId,
    gatewayIp,
    mac,
  }));
}

export type ShellyRpcPassword = {
  password?: string;
  /** Where the password came from, for error messages (never the value). */
  source: string;
};

/** Per-device password from smarthome.yml, else SHELLY_RPC_PASSWORD. */
export function getShellyRpcPassword(host: string): ShellyRpcPassword {
  const live = getLiveSmarthomeConfig();
  const device = live.ok ? live.config.passwordsByIp.get(host) : undefined;
  if (device) {
    return {
      password: device.password,
      source: `password of "${device.deviceId}" in smarthome.yml`,
    };
  }
  const password = process.env.SHELLY_RPC_PASSWORD?.trim();
  return { password: password || undefined, source: "SHELLY_RPC_PASSWORD" };
}

export function uniqueGatewayIps(bindings: SensorBinding[]): string[] {
  return [...new Set(bindings.map((b) => b.gatewayIp))];
}
