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

export type BvgDeparturesResult = {
  stops: BvgStopDepartures[];
  fetchedAt: string;
  warnings: string[];
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

type StopConfig = {
  id: string;
  name: string;
};

function getStopConfigs(): { stops: StopConfig[]; durationMin: number } {
  const durationMin = Number(process.env.BVG_DURATION_MIN ?? "30");
  const stops: StopConfig[] = [
    {
      id: process.env.BVG_STOP_1_ID?.trim() ?? "",
      name: process.env.BVG_STOP_1_NAME?.trim() || "Haltestelle 1",
    },
    {
      id: process.env.BVG_STOP_2_ID?.trim() ?? "",
      name: process.env.BVG_STOP_2_NAME?.trim() || "Haltestelle 2",
    },
  ].filter((s) => s.id);

  if (stops.length === 0) {
    throw new Error("No BVG_STOP_*_ID configured");
  }

  return {
    stops,
    durationMin: Number.isFinite(durationMin) && durationMin > 0 ? durationMin : 30,
  };
}

async function fetchStop(
  stop: StopConfig,
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
    headers: { "User-Agent": "rrs37-dashboard/0.1" },
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

async function loadBvgDepartures(): Promise<BvgDeparturesResult> {
  const { stops, durationMin } = getStopConfigs();
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

  // Keep configured order
  results.sort(
    (a, b) =>
      stops.findIndex((s) => s.id === a.stopId) -
      stops.findIndex((s) => s.id === b.stopId),
  );

  return {
    stops: results,
    fetchedAt: new Date().toISOString(),
    warnings,
  };
}

export async function getBvgDepartures(): Promise<BvgDeparturesResult> {
  return cacheGetOrSet("bvg:departures", CACHE_TTL.bvg, loadBvgDepartures);
}
