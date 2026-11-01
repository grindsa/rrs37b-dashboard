"use client";

import { useEffect, useState } from "react";
import type { ShellySensor, ShellySensorsResult } from "@/lib/shelly";
import {
  formatBattery,
  formatHumidity,
  formatRelativeAge,
  formatTemp,
} from "@/lib/format";
import { onForeground } from "@/lib/foreground-refresh";
import { SectionMeta, sectionFeedStatus } from "./SectionMeta";

const POLL_MS = 45_000;

type LoadState =
  | { status: "loading"; data?: ShellySensorsResult }
  | { status: "live"; data: ShellySensorsResult }
  | { status: "error"; message: string; data?: ShellySensorsResult };

function SensorRow({
  sensor,
  nowMs,
}: {
  sensor: ShellySensor;
  nowMs: number | null;
}) {
  const age = formatRelativeAge(sensor.updatedAt, nowMs);
  const offline = !sensor.online;

  return (
    <li
      className={[
        "grid grid-cols-[1fr_auto] items-end gap-x-4 gap-y-1 transition-opacity duration-300",
        offline ? "opacity-55" : undefined,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div>
        <p className="text-sm font-medium text-muted">
          {sensor.label}
          {offline ? (
            <span className="ml-2 text-xs font-normal text-warning">
              {sensor.updatedAt ? "veraltet" : "offline"}
            </span>
          ) : null}
        </p>
        <p className="mt-0.5 text-[2.35rem] font-semibold leading-none tracking-tight tabular-nums">
          {formatTemp(sensor.temperatureC)}
        </p>
        {age ? (
          <p className="mt-1.5 text-[0.7rem] tabular-nums text-muted">{age}</p>
        ) : null}
      </div>
      <div className="pb-1 text-right text-sm tabular-nums text-muted">
        <p>Luftfeuchtigkeit {formatHumidity(sensor.humidityPct)}</p>
        <p
          className={
            sensor.batteryPct !== null && sensor.batteryPct < 20
              ? "text-warning"
              : undefined
          }
        >
          Batterie {formatBattery(sensor.batteryPct)}
        </p>
      </div>
    </li>
  );
}

function PlaceholderRows() {
  return (
    <ul className="mt-5 flex flex-col gap-6" aria-hidden>
      {["Aussen", "Arbeitszimmer", "Wohnzimmer"].map((label) => (
        <li
          key={label}
          className="grid grid-cols-[1fr_auto] items-end gap-x-4 opacity-40"
        >
          <div>
            <p className="text-sm font-medium text-muted">{label}</p>
            <p className="mt-0.5 text-[2.35rem] font-semibold leading-none tracking-tight tabular-nums">
              —
            </p>
          </div>
          <div className="pb-1 text-right text-sm text-muted">
            <p>Luftfeuchtigkeit —</p>
            <p>Batterie —</p>
          </div>
        </li>
      ))}
    </ul>
  );
}

export function SensorsPlaceholder() {
  return (
    <section aria-labelledby="sensors-heading">
      <div className="flex items-end justify-between gap-3">
        <h2 id="sensors-heading" className="section-label">
          Sensoren
        </h2>
        <p className="text-xs text-muted">Laden…</p>
      </div>
      <PlaceholderRows />
    </section>
  );
}

export function SensorsSection({
  initialData,
}: {
  initialData?: ShellySensorsResult;
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
        const response = await fetch("/api/sensors", { cache: "no-store" });
        const data = (await response.json()) as ShellySensorsResult & {
          error?: string;
        };
        if (cancelled) return;
        if (!response.ok) {
          setState((prev) => ({
            status: "error",
            message: data.error ?? `HTTP ${response.status}`,
            data: data.sensors?.length ? data : prev.data,
          }));
          return;
        }
        setState({ status: "live", data });
      } catch (error) {
        if (cancelled) return;
        setState((prev) => ({
          status: "error",
          message:
            error instanceof Error ? error.message : "Sensoren nicht erreichbar",
          data: prev.data,
        }));
      }
    }

    // Initial data already came from the server — poll only after the first interval.
    if (!initialData) void load();
    const id = window.setInterval(() => void load(), POLL_MS);
    const stopFg = onForeground(() => void load());
    return () => {
      cancelled = true;
      window.clearInterval(id);
      stopFg();
    };
  }, [initialData]);

  const data = state.data;
  const sensors = data?.sensors;
  const feed = sectionFeedStatus({
    loading: state.status === "loading",
    hasData: Boolean(sensors?.length),
    error: state.status === "error",
  });

  const warnings =
    state.status === "live"
      ? state.data.warnings
      : state.status === "error"
        ? [
            ...(state.data?.warnings ?? []),
            ...(state.data ? [] : [state.message]),
          ]
        : [];

  return (
    <section className="animate-fade-up delay-1" aria-labelledby="sensors-heading">
      <div className="flex items-end justify-between gap-3">
        <h2 id="sensors-heading" className="section-label">
          Sensoren
        </h2>
        <SectionMeta
          status={feed}
          fetchedAt={data?.fetchedAt}
          nowMs={nowMs}
        />
      </div>

      {sensors?.length ? (
        <ul className="mt-5 flex flex-col gap-6">
          {sensors.map((sensor) => (
            <SensorRow key={sensor.id} sensor={sensor} nowMs={nowMs} />
          ))}
        </ul>
      ) : (
        <PlaceholderRows />
      )}

      {state.status === "error" && state.data ? (
        <p className="mt-4 text-xs text-warning">{state.message}</p>
      ) : null}

      {warnings.length > 0 ? (
        <ul className="mt-4 space-y-1 text-xs text-warning">
          {warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
