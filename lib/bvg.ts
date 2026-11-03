/**
 * BVG live departures via https://v6.bvg.transport.rest
 */

import { CACHE_TTL, cacheGetOrSet } from "./cache";

export type BvgDeparture = {
  line: string;
  direction: string;
  when: string | null;
  plannedWhen: string | null;
  delaySeconds: number | null;
  cancelled: boolean;
};

export type BvgStopDepartures = {
  stopId: string;
  stopName: string;
  departures: BvgDeparture[];
  fetchedAt: string;
};

export type BvgStopConfig = {
  id: string;
  name: string;
};

export type BvgDeparturesResult = {
  stops: BvgStopDepartures[];
  fetchedAt: string;
  warnings: string[];
  candidates: BvgStopConfig[];
  mode: "home" | "stop";
};

export type BvgNearbyStop = {
  id: string;
  name: string;
  distance: number;
};

type BvgApiDeparture = {
  when: string | null;
  plannedWhen: string | null;
  delay: number | null;
  cancelled?: boolean;
  direction?: string;
  line?: { name?: string };
};

type BvgApiResponse = {
  departures?: BvgApiDeparture[];
};

type BvgNearbyApiItem = {
  type?: string;
  id?: string;
  name?: string;
  distance?: number;
};

const USER_AGENT = "rrs37-dashboard/0.1";

export function getDurationMin(): number {
  const durationMin = Number(process.env.BVG_DURATION_MIN ?? "30");
  return Number.isFinite(durationMin) && durationMin > 0 ? durationMin : 30;
}

/** All configured stops: BVG_STOP_1_* … BVG_STOP_N_* */
export function getAllStopConfigs(): BvgStopConfig[] {
  const stops: BvgStopConfig[] = [];
  for (let i = 1; i <= 20; i++) {
    const id = process.env[`BVG_STOP_${i}_ID`]?.trim() ?? "";
    if (!id) continue;
    const name =
      process.env[`BVG_STOP_${i}_NAME`]?.trim() || `Haltestelle ${i}`;
    stops.push({ id, name });
  }
  return stops;
}

/** Home pair = first two configured stops (two-column default). */
export function getHomeStopConfigs(): BvgStopConfig[] {
  return getAllStopConfigs().slice(0, 2);
}

export function getHouseCoords(): { lat: number; lon: number } {
  const lat = Number(process.env.OPEN_METEO_LAT);
  const lon = Number(process.env.OPEN_METEO_LON);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    throw new Error("Missing or invalid OPEN_METEO_LAT / OPEN_METEO_LON");
  }
  return { lat, lon };
}

async function fetchStop(
  stop: BvgStopConfig,
  durationMin: number,
): Promise<BvgStopDepartures> {
  const url = new URL(
    `https://v6.bvg.transport.rest/stops/${encodeURIComponent(stop.id)}/departures`,
  );
  url.searchParams.set("duration", String(durationMin));
  url.searchParams.set("results", "12");
  url.searchParams.set("language", "de");

  const response = await fetch(url, {
    cache: "no-store",
    headers: { "User-Agent": USER_AGENT },
  });
  if (!response.ok) {
    throw new Error(`BVG HTTP ${response.status} for stop ${stop.id}`);
  }

  const payload = (await response.json()) as BvgApiResponse;
  const departures: BvgDeparture[] = (payload.departures ?? []).map((dep) => ({
    line: dep.line?.name ?? "?",
    direction: dep.direction ?? "—",
    when: dep.when,
    plannedWhen: dep.plannedWhen,
    delaySeconds: dep.delay,
    cancelled: Boolean(dep.cancelled),
  }));

  return {
    stopId: stop.id,
    stopName: stop.name,
    departures,
    fetchedAt: new Date().toISOString(),
  };
}

async function loadStops(
  stops: BvgStopConfig[],
  durationMin: number,
): Promise<{ results: BvgStopDepartures[]; warnings: string[] }> {
  const warnings: string[] = [];
  const results: BvgStopDepartures[] = [];

  await Promise.all(
    stops.map(async (stop) => {
      try {
        results.push(await fetchStop(stop, durationMin));
      } catch (error) {
        warnings.push(
          error instanceof Error ? error.message : `BVG failed for ${stop.id}`,
        );
        results.push({
          stopId: stop.id,
          stopName: stop.name,
          departures: [],
          fetchedAt: new Date().toISOString(),
        });
      }
    }),
  );

  results.sort(
    (a, b) =>
      stops.findIndex((s) => s.id === a.stopId) -
      stops.findIndex((s) => s.id === b.stopId),
  );

  return { results, warnings };
}

async function loadHomeDepartures(): Promise<BvgDeparturesResult> {
  const candidates = getAllStopConfigs();
  const home = getHomeStopConfigs();
  if (home.length === 0) {
    throw new Error("No BVG_STOP_*_ID configured");
  }

  const { results, warnings } = await loadStops(home, getDurationMin());
  return {
    stops: results,
    fetchedAt: new Date().toISOString(),
    warnings,
    candidates,
    mode: "home",
  };
}

async function loadSingleDepartures(
  stopId: string,
  stopName?: string,
): Promise<BvgDeparturesResult> {
  const candidates = getAllStopConfigs();
  const fromConfig = candidates.find((s) => s.id === stopId);
  const stop: BvgStopConfig = {
    id: stopId,
    name: stopName?.trim() || fromConfig?.name || "Haltestelle",
  };

  const { results, warnings } = await loadStops([stop], getDurationMin());
  return {
    stops: results,
    fetchedAt: new Date().toISOString(),
    warnings,
    candidates,
    mode: "stop",
  };
}

export async function getBvgDepartures(options?: {
  stopId?: string;
  stopName?: string;
}): Promise<BvgDeparturesResult> {
  const stopId = options?.stopId?.trim();
  if (stopId) {
    // Keyed by stop only; the client-supplied name is display-only.
    const cached = await cacheGetOrSet(
      `bvg:departures:${stopId}`,
      CACHE_TTL.bvg,
      () => loadSingleDepartures(stopId),
    );
    const stopName = options?.stopName?.trim();
    if (!stopName) return cached;
    return {
      ...cached,
      stops: cached.stops.map((stop) => ({ ...stop, stopName })),
    };
  }

  return cacheGetOrSet("bvg:home", CACHE_TTL.bvg, loadHomeDepartures);
}

export async function findNearbyStops(
  lat: number,
  lon: number,
  opts?: { results?: number; distance?: number },
): Promise<BvgNearbyStop[]> {
  const url = new URL("https://v6.bvg.transport.rest/locations/nearby");
  url.searchParams.set("latitude", String(lat));
  url.searchParams.set("longitude", String(lon));
  url.searchParams.set("results", String(opts?.results ?? 8));
  url.searchParams.set("stops", "true");
  url.searchParams.set("poi", "false");
  url.searchParams.set("language", "de");
  if (opts?.distance != null) {
    url.searchParams.set("distance", String(opts.distance));
  }

  const response = await fetch(url, {
    cache: "no-store",
    headers: { "User-Agent": USER_AGENT },
  });
  if (!response.ok) {
    throw new Error(`BVG nearby HTTP ${response.status}`);
  }

  const payload = (await response.json()) as BvgNearbyApiItem[];
  if (!Array.isArray(payload)) {
    throw new Error("BVG nearby returned unexpected payload");
  }

  return payload
    .filter((item) => item.id && item.name)
    .map((item) => ({
      id: item.id as string,
      name: item.name as string,
      distance: typeof item.distance === "number" ? item.distance : 0,
    }));
}

export async function getNearestStop(
  lat: number,
  lon: number,
): Promise<BvgNearbyStop> {
  const key = `bvg:nearby:${lat.toFixed(4)}:${lon.toFixed(4)}`;
  return cacheGetOrSet(key, CACHE_TTL.bvg, async () => {
    const stops = await findNearbyStops(lat, lon, {
      results: 5,
      distance: 1500,
    });
    if (stops.length === 0) {
      throw new Error("Keine Haltestelle in der Nähe gefunden");
    }
    return stops[0];
  });
}
