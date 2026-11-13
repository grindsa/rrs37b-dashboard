/**
 * Photovoltaik snapshot — Growatt NOAH (SoC via noah-mqtt), APsystems EZ1-M
 * (solar W), Shelly Pro 3EM (house W).
 *
 * House (Shelly) and generation/battery (EZ1 + NOAH) are loaded and cached
 * separately so the UI can show Hausverbrauch before slow/unreachable devices
 * time out.
 */

import { cacheGetOrSet, CACHE_TTL } from "./cache";
import { fetchEz1Production } from "./pv-ez1";
import { fetchNoahReading } from "./pv-noah";
import { fetchShellyPro3Em, getHouseMeter } from "./pv-shelly-em";
import {
  mergePvParts,
  type PvHouseSnapshot,
  type PvRestSnapshot,
  type PvSnapshot,
} from "./pv-types";

export type {
  PvHouseSnapshot,
  PvRestSnapshot,
  PvSnapshot,
} from "./pv-types";
export { mergePvParts } from "./pv-types";

function warningFrom(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

function envSet(name: string): boolean {
  return Boolean(process.env[name]?.trim());
}

async function loadPvHouse(): Promise<PvHouseSnapshot> {
  const warnings: string[] = [];
  let houseW: number | null = null;

  const houseMeter = getHouseMeter();
  if (!houseMeter.ok) {
    warnings.push(houseMeter.warning);
  } else {
    try {
      const reading = await fetchShellyPro3Em(houseMeter.meter);
      houseW = reading.totalActPowerW;
    } catch (error: unknown) {
      warnings.push(
        warningFrom(error, "Shelly Pro 3EM Hausverbrauch nicht verfügbar"),
      );
    }
  }

  return {
    houseW,
    fetchedAt: new Date().toISOString(),
    warnings,
  };
}

async function loadPvRest(): Promise<PvRestSnapshot> {
  const warnings: string[] = [];

  let socPct: number | null = null;
  let chargeW: number | null = null;
  let dischargeW: number | null = null;
  let noahSolarW: number | null = null;
  let workMode: string | null = null;
  let solarW: number | null = null;

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
          noahSolarW = reading.solarW;
          workMode = reading.workMode;
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

  await Promise.all(tasks);

  return {
    socPct,
    chargeW,
    dischargeW,
    noahSolarW,
    workMode,
    solarW,
    fetchedAt: new Date().toISOString(),
    warnings,
  };
}

export async function getPvHouseSnapshot(): Promise<PvHouseSnapshot> {
  return cacheGetOrSet("pv:house", CACHE_TTL.pv, loadPvHouse);
}

export async function getPvRestSnapshot(): Promise<PvRestSnapshot> {
  return cacheGetOrSet("pv:rest", CACHE_TTL.pv, loadPvRest);
}

export async function getPvSnapshot(): Promise<PvSnapshot> {
  const [house, rest] = await Promise.all([
    getPvHouseSnapshot(),
    getPvRestSnapshot(),
  ]);
  return mergePvParts(house, rest);
}
