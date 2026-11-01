"use client";

import { useEffect, useState } from "react";
import type { WeatherSnapshot } from "@/lib/weather";
import {
  formatHourLabel,
  formatPrecipitation,
  formatTemp,
  weatherLabel,
} from "@/lib/format";
import { onForeground } from "@/lib/foreground-refresh";
import { SectionMeta, sectionFeedStatus } from "./SectionMeta";
import { WeatherIcon } from "./WeatherIcon";

type StripMode = "temp" | "precip";

const POLL_MS = 12 * 60_000;

type LoadState =
  | { status: "loading"; data?: WeatherSnapshot }
  | { status: "live"; data: WeatherSnapshot }
  | { status: "error"; message: string; data?: WeatherSnapshot };

export function WeatherPlaceholder() {
  return (
    <section aria-labelledby="weather-heading">
      <div className="flex items-end justify-between gap-3">
        <h2 id="weather-heading" className="section-label">
          Wetter
        </h2>
        <p className="text-xs text-muted">Laden…</p>
      </div>
      <div className="mt-5 opacity-40" aria-hidden>
        <div className="flex items-center gap-4">
          <div className="h-14 w-14 rounded-full bg-surface" />
          <div>
            <p className="text-sm text-muted">Nächste Stunde</p>
            <p className="mt-1 text-[2.75rem] font-semibold leading-none tracking-tight">
              —
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

export function WeatherSection({
  initialData,
}: {
  initialData?: WeatherSnapshot;
}) {
  const [mode, setMode] = useState<StripMode>("temp");
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
        const response = await fetch("/api/weather", { cache: "no-store" });
        const data = (await response.json()) as WeatherSnapshot & {
          error?: string;
        };
        if (cancelled) return;
        if (!response.ok) {
          setState((prev) => ({
            status: "error",
            message: data.error ?? `HTTP ${response.status}`,
            data: prev.data,
          }));
          return;
        }
        setState({ status: "live", data });
      } catch (error) {
        if (cancelled) return;
        setState((prev) => ({
          status: "error",
          message:
            error instanceof Error ? error.message : "Wetter nicht erreichbar",
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

  const weather = state.data;
  const feed = sectionFeedStatus({
    loading: state.status === "loading",
    hasData: Boolean(weather),
    error: state.status === "error",
  });

  return (
    <section className="animate-fade-up delay-2" aria-labelledby="weather-heading">
      <div className="flex items-end justify-between gap-3">
        <h2 id="weather-heading" className="section-label">
          Wetter
        </h2>
        <div className="flex items-center gap-3">
          <SectionMeta
            status={feed}
            fetchedAt={weather?.fetchedAt}
            nowMs={nowMs}
          />
          <div
            role="group"
            aria-label="6-Stunden-Anzeige"
            className="inline-flex items-center gap-0.5 rounded-lg bg-surface p-0.5 text-xs font-medium"
          >
            {(
              [
                { value: "temp" as const, label: "°C" },
                { value: "precip" as const, label: "mm" },
              ] as const
            ).map((option) => {
              const active = mode === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setMode(option.value)}
                  className={[
                    "rounded-md px-2.5 py-1.5 transition-colors duration-200",
                    active
                      ? "bg-accent text-on-accent"
                      : "text-muted hover:text-foreground",
                  ].join(" ")}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {state.status === "error" ? (
        <p className="mt-3 text-xs text-warning">{state.message}</p>
      ) : null}

      {weather ? (
        <>
          <div
            className={[
              "mt-5 flex items-center gap-4 transition-opacity duration-300",
              feed === "stale" ? "opacity-70" : undefined,
            ]
              .filter(Boolean)
              .join(" ")}
          >
            <WeatherIcon
              code={weather.nextHour.weatherCode}
              className="h-14 w-14 shrink-0 text-accent"
            />
            <div className="min-w-0">
              <p className="text-sm text-muted">Nächste Stunde</p>
              <p className="mt-1 text-[2.75rem] font-semibold leading-none tracking-tight tabular-nums">
                {formatTemp(weather.nextHour.temperatureC)}
              </p>
              <p className="mt-2 text-sm text-muted">
                {weatherLabel(weather.nextHour.weatherCode)}
                {weather.nextHour.precipitationMm > 0
                  ? ` · ${formatPrecipitation(weather.nextHour.precipitationMm)} mm`
                  : null}
              </p>
            </div>
          </div>

          <ul className="mt-7 grid grid-cols-6 gap-1 sm:gap-2">
            {weather.next6Hours.map((hour) => (
              <li
                key={hour.time}
                className="flex min-w-0 flex-col items-center gap-1.5 py-1 text-center"
              >
                <span className="text-[0.7rem] tabular-nums text-muted">
                  {formatHourLabel(hour.time)}
                </span>
                <WeatherIcon
                  code={hour.weatherCode}
                  className="h-6 w-6 text-foreground/75"
                />
                <span className="text-sm font-medium tabular-nums">
                  {mode === "temp"
                    ? formatTemp(hour.temperatureC).replace("°", "")
                    : formatPrecipitation(hour.precipitationMm)}
                </span>
                <span className="text-[0.65rem] text-muted">
                  {mode === "temp" ? "°C" : "mm"}
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <div className="mt-5 opacity-40" aria-hidden>
          <div className="flex items-center gap-4">
            <div className="h-14 w-14 rounded-full bg-surface" />
            <div>
              <p className="text-sm text-muted">Nächste Stunde</p>
              <p className="mt-1 text-[2.75rem] font-semibold leading-none tracking-tight">
                —
              </p>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
