"use client";

import { useEffect, useRef, useState } from "react";
import type {
  BvgDeparture,
  BvgDeparturesResult,
  BvgNearbyStop,
  BvgStopConfig,
  BvgStopDepartures,
} from "@/lib/bvg";
import { formatDelay, formatHourLabel, minutesUntil } from "@/lib/format";
import { onForeground } from "@/lib/foreground-refresh";
import { SectionMeta, sectionFeedStatus } from "./SectionMeta";

const POLL_MS = 45_000;
const STORAGE_KEY = "rrs37:bvg-selection";

const toneClass = {
  ok: "text-muted",
  early: "text-accent",
  late: "text-warning",
  cancelled: "text-danger",
} as const;

type LoadState =
  | { status: "loading"; data?: BvgDeparturesResult }
  | { status: "live"; data: BvgDeparturesResult }
  | { status: "error"; message: string; data?: BvgDeparturesResult };

type Selection =
  | { kind: "home" }
  | { kind: "stop"; stopId: string; stopName: string }
  | { kind: "nearby" };

type NearbyInfo = {
  stop: BvgNearbyStop;
  source: "gps" | "home";
  note?: string;
};

/** Less-useful short hops — keep visible but de-emphasized. */
function isMinorDeparture(dep: BvgDeparture): boolean {
  const line = dep.line.trim().toUpperCase();
  const direction = dep.direction.toLowerCase();
  if (line === "M2" && direction.includes("heinersdorf")) return true;
  if (
    line === "158" &&
    direction.includes("heinersdorf") &&
    direction.includes("wasserturm")
  ) {
    return true;
  }
  return false;
}

function relativeLabel(mins: number | null, cancelled: boolean): string {
  if (cancelled || mins === null) return "—";
  if (mins === 0) return "jetzt";
  return `${mins} Min`;
}

function readStoredSelection(): Selection {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { kind: "home" };
    const parsed = JSON.parse(raw) as Selection;
    if (parsed?.kind === "home" || parsed?.kind === "nearby") return parsed;
    if (
      parsed?.kind === "stop" &&
      typeof parsed.stopId === "string" &&
      typeof parsed.stopName === "string"
    ) {
      return parsed;
    }
  } catch {
    /* ignore */
  }
  return { kind: "home" };
}

function writeStoredSelection(selection: Selection) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(selection));
  } catch {
    /* ignore */
  }
}

function selectionValue(selection: Selection): string {
  if (selection.kind === "home") return "home";
  if (selection.kind === "nearby") return "nearby";
  return `stop:${selection.stopId}`;
}

function parseSelectionValue(
  value: string,
  candidates: BvgStopConfig[],
): Selection {
  if (value === "home") return { kind: "home" };
  if (value === "nearby") return { kind: "nearby" };
  if (value.startsWith("stop:")) {
    const stopId = value.slice(5);
    const match = candidates.find((c) => c.id === stopId);
    if (match) return { kind: "stop", stopId: match.id, stopName: match.name };
  }
  return { kind: "home" };
}

function getPosition(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("Geolocation nicht verfügbar"));
      return;
    }
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: false,
      timeout: 8_000,
      maximumAge: 60_000,
    });
  });
}

async function resolveNearby(): Promise<NearbyInfo> {
  let lat: number | undefined;
  let lon: number | undefined;
  let note: string | undefined;

  try {
    const pos = await getPosition();
    lat = pos.coords.latitude;
    lon = pos.coords.longitude;
  } catch {
    note = "GPS nicht verfügbar — Nähe Zuhause";
  }

  // ~100 m precision is enough for the nearest stop and keeps exact
  // positions out of proxy access logs.
  const params = new URLSearchParams();
  if (lat != null && lon != null) {
    params.set("lat", lat.toFixed(3));
    params.set("lon", lon.toFixed(3));
  }

  const qs = params.toString();
  const response = await fetch(`/api/bvg/nearby${qs ? `?${qs}` : ""}`, {
    cache: "no-store",
  });
  const data = (await response.json()) as {
    stop?: BvgNearbyStop;
    source?: "gps" | "home";
    error?: string;
  };
  if (!response.ok || !data.stop) {
    throw new Error(data.error ?? `Nearby HTTP ${response.status}`);
  }

  return {
    stop: data.stop,
    source: data.source ?? (lat != null ? "gps" : "home"),
    note: data.source === "home" ? note ?? "Nähe Zuhause" : note,
  };
}

function Stops({
  stops,
  nowMs,
  dimmed,
}: {
  stops: BvgStopDepartures[];
  nowMs: number | null;
  dimmed?: boolean;
}) {
  return (
    <div
      className={[
        "mt-5 grid gap-8",
        stops.length > 1 ? "md:grid-cols-2 md:gap-10" : undefined,
        dimmed ? "opacity-70 transition-opacity duration-300" : undefined,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {stops.map((stop) => (
        <div key={stop.stopId}>
          <h3 className="text-sm font-medium text-foreground">
            {stop.stopName}
          </h3>
          <ul className="mt-3.5 flex flex-col gap-3.5">
            {stop.departures.length === 0 ? (
              <li className="text-sm text-muted">Keine Abfahrten in 30 Min</li>
            ) : (
              stop.departures.map((dep, index) => {
                const mins = minutesUntil(dep.when, nowMs);
                const delay = formatDelay(dep.delaySeconds, dep.cancelled);
                const clockIso = dep.when ?? dep.plannedWhen;
                const minor = isMinorDeparture(dep);
                return (
                  <li
                    key={`${dep.line}-${dep.direction}-${dep.plannedWhen}-${index}`}
                    className={[
                      "grid grid-cols-[3rem_1fr_auto] items-baseline gap-3",
                      minor ? "opacity-45" : undefined,
                    ]
                      .filter(Boolean)
                      .join(" ")}
                  >
                    <span
                      className={[
                        "font-semibold tabular-nums",
                        minor ? "text-muted" : "text-accent",
                      ].join(" ")}
                    >
                      {dep.line}
                    </span>
                    <div className="min-w-0">
                      <p
                        className={[
                          "truncate text-sm",
                          minor ? "text-muted" : undefined,
                        ]
                          .filter(Boolean)
                          .join(" ")}
                      >
                        {dep.direction}
                      </p>
                      {delay.label ? (
                        <p
                          className={`text-xs ${
                            minor ? "text-muted" : toneClass[delay.tone]
                          }`}
                        >
                          {delay.label}
                        </p>
                      ) : null}
                    </div>
                    <div
                      className={[
                        "text-right tabular-nums",
                        minor ? "text-muted" : undefined,
                      ]
                        .filter(Boolean)
                        .join(" ")}
                    >
                      <p className="text-sm font-semibold">
                        {clockIso ? formatHourLabel(clockIso) : "—"}
                      </p>
                      <p className="text-xs text-muted">
                        {relativeLabel(mins, dep.cancelled)}
                      </p>
                    </div>
                  </li>
                );
              })
            )}
          </ul>
        </div>
      ))}
    </div>
  );
}

export function BvgPlaceholder() {
  return (
    <section aria-labelledby="bvg-heading">
      <div className="flex items-end justify-between gap-3">
        <h2 id="bvg-heading" className="section-label">
          Abfahrten · 30 Min
        </h2>
        <p className="text-xs text-muted">Laden…</p>
      </div>
      <p className="mt-5 text-sm text-muted">Lade Abfahrten…</p>
    </section>
  );
}

export function BvgSection({
  initialData,
}: {
  initialData?: BvgDeparturesResult;
}) {
  const [selection, setSelection] = useState<Selection>({ kind: "home" });
  const [hydrated, setHydrated] = useState(false);
  const [nearby, setNearby] = useState<NearbyInfo | null>(null);
  const [nearbyBusy, setNearbyBusy] = useState(false);
  const [state, setState] = useState<LoadState>(() =>
    initialData ? { status: "live", data: initialData } : { status: "loading" },
  );
  const [nowMs, setNowMs] = useState<number | null>(null);
  const skipInitialHomeFetch = useRef(Boolean(initialData));

  const candidates =
    state.data?.candidates ?? initialData?.candidates ?? [];
  // First two configured stops are "Zuhause" — don't repeat them in the list.
  const extraStops = candidates.slice(2);

  useEffect(() => {
    const stored = readStoredSelection();
    setSelection(stored);
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated || candidates.length === 0) return;
    if (selection.kind !== "stop") return;
    // Only extra stops (beyond Zuhause pair) are valid single selections.
    if (candidates.slice(2).some((c) => c.id === selection.stopId)) return;
    setSelection({ kind: "home" });
  }, [candidates, hydrated, selection]);

  useEffect(() => {
    if (!hydrated) return;
    writeStoredSelection(selection);
  }, [selection, hydrated]);

  useEffect(() => {
    const tickNow = () => setNowMs(Date.now());
    tickNow();
    const tick = window.setInterval(tickNow, 30_000);
    const stopFg = onForeground(tickNow);
    return () => {
      window.clearInterval(tick);
      stopFg();
    };
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    if (selection.kind !== "nearby") {
      setNearby(null);
      setNearbyBusy(false);
      return;
    }

    let cancelled = false;

    async function resolve() {
      setNearbyBusy(true);
      try {
        const info = await resolveNearby();
        if (cancelled) return;
        setNearby(info);
      } catch (error) {
        if (cancelled) return;
        setNearby(null);
        setState((prev) => ({
          status: "error",
          message:
            error instanceof Error
              ? error.message
              : "Haltestelle in der Nähe nicht gefunden",
          data: prev.data,
        }));
      } finally {
        if (!cancelled) setNearbyBusy(false);
      }
    }

    void resolve();
    return () => {
      cancelled = true;
    };
  }, [selection, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    if (selection.kind === "nearby" && !nearby) return;

    let cancelled = false;

    function departuresUrl(): string {
      if (selection.kind === "stop") {
        const params = new URLSearchParams({
          stopId: selection.stopId,
          name: selection.stopName,
        });
        return `/api/bvg?${params}`;
      }
      if (selection.kind === "nearby" && nearby) {
        const params = new URLSearchParams({
          stopId: nearby.stop.id,
          name: nearby.stop.name,
        });
        return `/api/bvg?${params}`;
      }
      return "/api/bvg";
    }

    async function load() {
      try {
        const response = await fetch(departuresUrl(), { cache: "no-store" });
        const data = (await response.json()) as BvgDeparturesResult & {
          error?: string;
        };
        if (cancelled) return;
        if (!response.ok) {
          setState((prev) => ({
            status: "error",
            message: data.error ?? `HTTP ${response.status}`,
            data: data.stops?.length ? data : prev.data,
          }));
          return;
        }
        setState({ status: "live", data });
      } catch (error) {
        if (cancelled) return;
        setState((prev) => ({
          status: "error",
          message:
            error instanceof Error ? error.message : "BVG nicht erreichbar",
          data: prev.data,
        }));
      }
    }

    if (selection.kind !== "home") {
      skipInitialHomeFetch.current = false;
    }
    const skipOnce =
      selection.kind === "home" && skipInitialHomeFetch.current;
    if (skipOnce) {
      skipInitialHomeFetch.current = false;
    } else {
      void load();
    }

    const id = window.setInterval(() => void load(), POLL_MS);
    const stopFg = onForeground(() => void load());
    return () => {
      cancelled = true;
      window.clearInterval(id);
      stopFg();
    };
  }, [selection, nearby, hydrated, initialData]);

  const stops = state.data?.stops;
  const feed = sectionFeedStatus({
    loading: state.status === "loading" || nearbyBusy,
    hasData: Boolean(stops?.length),
    error: state.status === "error",
  });

  const uniqueWarnings = [
    ...new Set(
      [
        ...(state.data?.warnings ?? []),
        nearby?.note,
        state.status === "error" ? state.message : null,
      ].filter((w): w is string => Boolean(w)),
    ),
  ];

  return (
    <section className="animate-fade-up delay-3" aria-labelledby="bvg-heading">
      <div className="flex items-end justify-between gap-3">
        <h2 id="bvg-heading" className="section-label">
          Abfahrten · 30 Min
        </h2>
        <SectionMeta
          status={feed}
          fetchedAt={state.data?.fetchedAt}
          nowMs={nowMs}
        />
      </div>

      <div className="mt-3">
        <label className="sr-only" htmlFor="bvg-stop-select">
          Haltestelle
        </label>
        <select
          id="bvg-stop-select"
          className="w-full max-w-sm rounded-md border border-hairline bg-transparent px-2.5 py-1.5 text-sm text-foreground outline-none focus:border-accent"
          value={selectionValue(selection)}
          onChange={(event) => {
            setSelection(parseSelectionValue(event.target.value, candidates));
          }}
        >
          <option value="home">Zuhause</option>
          {extraStops.map((stop) => (
            <option key={stop.id} value={`stop:${stop.id}`}>
              {stop.name}
            </option>
          ))}
          <option value="nearby">Aktuelle Position</option>
        </select>
        {selection.kind === "nearby" && nearby ? (
          <p className="mt-1.5 text-xs text-muted">
            {nearby.stop.name}
            {nearby.stop.distance > 0
              ? ` · ${nearby.stop.distance} m`
              : null}
            {nearby.source === "home" ? " · Zuhause-Koordinaten" : null}
          </p>
        ) : null}
      </div>

      {stops?.length ? (
        <Stops stops={stops} nowMs={nowMs} dimmed={feed === "stale"} />
      ) : (
        <p className="mt-5 text-sm text-muted">
          {feed === "offline"
            ? "Abfahrten gerade nicht erreichbar."
            : nearbyBusy
              ? "Suche Haltestelle in der Nähe…"
              : "Lade Abfahrten…"}
        </p>
      )}

      {uniqueWarnings.length > 0 ? (
        <ul className="mt-4 space-y-1 text-xs text-warning">
          {uniqueWarnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
