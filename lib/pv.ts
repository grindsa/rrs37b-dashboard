/**
 * Photovoltaik snapshot — Growatt NOAH (SoC via noah-mqtt), APsystems EZ1-M
 * (solar W), Shelly Pro 3EM (house W).
 */

import { cacheGetOrSet, CACHE_TTL } from "./cache";
import { fetchEz1Production } from "./pv-ez1";
import { fetchNoahReading } from "./pv-noah";
import { fetchShellyPro3Em, getHouseMeter } from "./pv-shelly-em";

export type PvSnapshot = {
  socPct: number | null;
  /** Battery charge power (W) when NOAH reports it. */
  chargeW: number | null;
  /** Battery discharge power (W) when NOAH reports it. */
  dischargeW: number | null;
  solarW: number | null;
  houseW: number | null;
  /** solarW − houseW when both readings exist. */
  netW: number | null;
  fetchedAt: string;
  warnings: string[];
};

function warningFrom(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

function envSet(name: string): boolean {
  return Boolean(process.env[name]?.trim());
}

async function loadPvSnapshot(): Promise<PvSnapshot> {
  const warnings: string[] = [];

  let socPct: number | null = null;
  let chargeW: number | null = null;
  let dischargeW: number | null = null;
  let solarW: number | null = null;
  let houseW: number | null = null;

  const tasks: Promise<void>[] = [];

  if (!envSet("NOAH_MQTT_URL")) {
    warnings.push(
      "NOAH_MQTT_URL nicht gesetzt — Batterie-SoC noch nicht angebunden.",
    );
  } else {
    tasks.push(
      fetchNoahReading()
        .then((reading) => {
          if (!reading) return;
          socPct = reading.socPct;
          chargeW = reading.chargeW;
          dischargeW = reading.dischargeW;
        })
        .catch((error: unknown) => {
          warnings.push(warningFrom(error, "NOAH SoC nicht verfügbar"));
        }),
    );
  }

  if (!envSet("APSYSTEMS_EZ1_HOST")) {
    warnings.push(
      "APSYSTEMS_EZ1_HOST nicht gesetzt — Erzeugung noch nicht angebunden.",
    );
  } else {
    tasks.push(
      fetchEz1Production()
        .then((reading) => {
          if (reading) solarW = reading.solarW;
        })
        .catch((error: unknown) => {
          warnings.push(warningFrom(error, "EZ1-M Solar-W nicht verfügbar"));
        }),
    );
  }

  const houseMeter = getHouseMeter();
  if (!houseMeter.ok) {
    warnings.push(houseMeter.warning);
  } else {
    tasks.push(
      fetchShellyPro3Em(houseMeter.meter)
        .then((reading) => {
          houseW = reading.totalActPowerW;
        })
        .catch((error: unknown) => {
          warnings.push(
            warningFrom(error, "Shelly Pro 3EM Hausverbrauch nicht verfügbar"),
          );
        }),
    );
  }

  await Promise.all(tasks);

  const netW =
    solarW !== null && houseW !== null ? solarW - houseW : null;

  return {
    socPct,
    chargeW,
    dischargeW,
    solarW,
    houseW,
    netW,
    fetchedAt: new Date().toISOString(),
    warnings,
  };
}

export async function getPvSnapshot(): Promise<PvSnapshot> {
  return cacheGetOrSet("pv:snapshot", CACHE_TTL.pv, loadPvSnapshot);
}
