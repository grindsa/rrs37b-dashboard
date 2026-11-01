/**
 * Shelly LAN RPC adapter — BLU H&T via Plug S Gen3 BLE gateways.
 * Implementation in a later phase; stub keeps the module boundary clear.
 */

export type ShellySensor = {
  id: string;
  label: "Aussen" | "Arbeitszimmer" | "Wohnzimmer";
  temperatureC: number | null;
  humidityPct: number | null;
  batteryPct: number | null;
  updatedAt: string | null;
  online: boolean;
};

export async function getShellySensors(): Promise<ShellySensor[]> {
  throw new Error("Shelly LAN adapter not implemented yet");
}
