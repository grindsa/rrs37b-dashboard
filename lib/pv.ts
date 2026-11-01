import { cacheGetOrSet, CACHE_TTL } from "./cache";

/**
 * Photovoltaik snapshot — Growatt NOAH (SoC via noah-mqtt), APsystems EZ1-M
 * (solar W), Shelly Pro 3EM (house W). No live bridges yet; returns placeholders
 * until MQTT / LAN IPs are wired.
 */
export type PvSnapshot = {
  socPct: number | null;
  solarW: number | null;
  houseW: number | null;
  fetchedAt: string;
  warnings: string[];
};

function envHost(name: string): string | null {
  const v = process.env[name]?.trim();
  return v || null;
}

export async function getPvSnapshot(): Promise<PvSnapshot> {
  return cacheGetOrSet("pv:snapshot", CACHE_TTL.pv, async () => {
    const warnings: string[] = [];
    const noahMqtt = envHost("NOAH_MQTT_URL");
    const ez1 = envHost("APSYSTEMS_EZ1_HOST");
    const shellyEm = envHost("SHELLY_PRO_3EM_HOST");

    if (!noahMqtt) {
      warnings.push("NOAH_MQTT_URL nicht gesetzt — SoC noch nicht angebunden.");
    } else {
      warnings.push("noah-mqtt Bridge noch nicht implementiert.");
    }
    if (!ez1) {
      warnings.push("APSYSTEMS_EZ1_HOST nicht gesetzt — Solar-W noch nicht angebunden.");
    } else {
      warnings.push("APsystems EZ1-M (:8050) Bridge noch nicht implementiert.");
    }
    if (!shellyEm) {
      warnings.push(
        "SHELLY_PRO_3EM_HOST nicht gesetzt — Hausverbrauch noch nicht angebunden.",
      );
    } else {
      warnings.push("Shelly Pro 3EM EM.GetStatus Bridge noch nicht implementiert.");
    }

    return {
      socPct: null,
      solarW: null,
      houseW: null,
      fetchedAt: new Date().toISOString(),
      warnings,
    };
  });
}
