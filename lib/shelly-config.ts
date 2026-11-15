import {
  getLiveSmarthomeConfig,
  UNKNOWN_SENSOR_MAC,
  type SensorLabel,
} from "./smarthome-config";

export type { SensorLabel };
export { UNKNOWN_SENSOR_MAC };

export type SensorBinding = {
  label: SensorLabel;
  /** Gateway plug or meter id from smarthome.yml; safe to show in client warnings. */
  gatewayId: string;
  /** Gateway device IP that should see this BLU device. */
  gatewayIp: string;
  /** Optional BLU MAC (aa:bb:…), or `unknown` for demo readings. */
  mac?: string;
  /** Heizung floor group when set; null = home Klima only. */
  groupId: string | null;
  /** Also listed on home Klima (always true when groupId is null). */
  showOnHome: boolean;
};

export function isUnknownSensorMac(mac: string | undefined): boolean {
  return mac === UNKNOWN_SENSOR_MAC;
}

/** Sensor → gateway mapping from the `sensors` section of smarthome.yml. */
export function getShellyBindings(): SensorBinding[] {
  const live = getLiveSmarthomeConfig();
  if (!live.ok) throw new Error(live.error);
  if (live.config.sensors.length === 0) {
    throw new Error("Keine Sensoren unter sensors in config/smarthome.yml");
  }
  return live.config.sensors.map(
    ({ label, gatewayId, gatewayIp, mac, groupId, showOnHome }) => ({
      label,
      gatewayId,
      gatewayIp,
      mac,
      groupId,
      showOnHome,
    }),
  );
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

/** Gateway IPs that need a live BTHome poll (`mac: unknown` is skipped). */
export function uniqueGatewayIps(bindings: SensorBinding[]): string[] {
  return [
    ...new Set(
      bindings
        .filter((b) => !isUnknownSensorMac(b.mac))
        .map((b) => b.gatewayIp),
    ),
  ];
}
