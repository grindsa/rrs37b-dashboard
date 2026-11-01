"use client";

import { useEffect, useState } from "react";
import type {
  BvgDeparture,
  BvgDeparturesResult,
  BvgStopDepartures,
} from "@/lib/bvg";
import { formatDelay, formatHourLabel, minutesUntil } from "@/lib/format";
import { onForeground } from "@/lib/foreground-refresh";
import { SectionMeta, sectionFeedStatus } from "./SectionMeta";

const POLL_MS = 45_000;

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

/** 158 → Heinersdorf, Am Wasserturm — keep visible but de-emphasized. */
function isMinorDeparture(dep: BvgDeparture): boolean {
  const line = dep.line.trim().toUpperCase();
  const direction = dep.direction.toLowerCase();
  return (
    line === "158" &&
    direction.includes("heinersdorf") &&
    direction.includes("wasserturm")
  );
}

function relativeLabel(mins: number | null, cancelled: boolean): string {
  if (cancelled || mins === null) return "—";
  if (mins === 0) return "jetzt";
  return `${mins} Min`;
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
        "mt-5 grid gap-8 md:grid-cols-2 md:gap-10",
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
  const [state, setState] = useState<LoadState>(() =>
    initialData ? { status: "live", data: initialData } : { status: "loading" },
  );
  const [nowMs, setNowMs] = useState<number | null>(null);

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
    let cancelled = false;

    async function load() {
      try {
        const response = await fetch("/api/bvg", { cache: "no-store" });
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

    if (!initialData) void load();
    const id = window.setInterval(() => void load(), POLL_MS);
    const stopFg = onForeground(() => void load());
    return () => {
      cancelled = true;
      window.clearInterval(id);
      stopFg();
    };
  }, [initialData]);

  const stops = state.data?.stops;
  const feed = sectionFeedStatus({
    loading: state.status === "loading",
    hasData: Boolean(stops?.length),
    error: state.status === "error",
  });

  const uniqueWarnings = [
    ...new Set(
      [
        ...(state.data?.warnings ?? []),
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

      {stops?.length ? (
        <Stops stops={stops} nowMs={nowMs} dimmed={feed === "stale"} />
      ) : (
        <p className="mt-5 text-sm text-muted">
          {feed === "offline"
            ? "Abfahrten gerade nicht erreichbar."
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
