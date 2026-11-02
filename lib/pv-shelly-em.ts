/**
 * Shelly Pro 3EM — house consumption via EM.GetStatus total_act_power (W).
 * Uses the first entry under `meters` in smarthome.yml.
 */

import { shellyRpc } from "./shelly-rpc";
import {
  getLiveSmarthomeConfig,
  type SmarthomeMeterConfig,
} from "./smarthome-config";

export type ShellyEmReading = {
  totalActPowerW: number;
};

type EmGetStatus = {
  id?: number;
  total_act_power?: number;
};

export function getHouseMeter():
  | { ok: true; meter: SmarthomeMeterConfig }
  | { ok: false; warning: string } {
  const live = getLiveSmarthomeConfig();
  if (!live.ok) {
    return {
      ok: false,
      warning: `${live.error} — Hausverbrauch nicht verfügbar.`,
    };
  }
  const meter = live.config.meters[0];
  if (!meter) {
    return {
      ok: false,
      warning:
        "Kein Zähler unter meters in smarthome.yml — Hausverbrauch noch nicht angebunden.",
    };
  }
  return { ok: true, meter };
}

export async function fetchShellyPro3Em(
  meter: SmarthomeMeterConfig,
): Promise<ShellyEmReading> {
  const status = await shellyRpc<EmGetStatus>(meter.ip, "EM.GetStatus", {
    id: meter.emId,
  });

  const w = status.total_act_power;
  if (typeof w !== "number" || !Number.isFinite(w)) {
    throw new Error(
      `Shelly Pro 3EM ${meter.id}: EM.GetStatus missing total_act_power`,
    );
  }

  return { totalActPowerW: w };
}
