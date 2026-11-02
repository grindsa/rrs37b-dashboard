/**
 * Shelly Pro 3EM — house consumption via EM.GetStatus total_act_power (W).
 */

import { shellyRpc } from "./shelly-rpc";

export type ShellyEmReading = {
  totalActPowerW: number;
};

type EmGetStatus = {
  id?: number;
  total_act_power?: number;
};

function envHost(): string | null {
  const v = process.env.SHELLY_PRO_3EM_HOST?.trim();
  return v || null;
}

function emId(): number {
  const raw = process.env.SHELLY_PRO_3EM_ID?.trim();
  if (!raw) return 0;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : 0;
}

export async function fetchShellyPro3Em(): Promise<ShellyEmReading | null> {
  const host = envHost();
  if (!host) return null;

  const status = await shellyRpc<EmGetStatus>(host, "EM.GetStatus", {
    id: emId(),
  });

  const w = status.total_act_power;
  if (typeof w !== "number" || !Number.isFinite(w)) {
    throw new Error(
      `Shelly Pro 3EM ${host}: EM.GetStatus missing total_act_power`,
    );
  }

  return { totalActPowerW: w };
}
