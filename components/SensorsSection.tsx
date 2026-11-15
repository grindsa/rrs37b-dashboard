"use client";

import { useEffect, useState } from "react";
import type { ShellySensor, ShellySensorsResult } from "@/lib/shelly";
import {
  formatBattery,
  formatHumidity,
  formatRelativeAge,
  formatTemp,
} from "@/lib/format";
import { isPageHidden, onForeground } from "@/lib/foreground-refresh";
import { SectionMeta, sectionFeedStatus } from "./SectionMeta";

const POLL_MS = 45_000;

/** Outdoor pair under shared “Aussen”; column order follows API/YAML. */
const AUSSEN_LABELS = new Set(["Aussen DG", "Aussen EG"]);

type LoadState =
  | { status: "loading"; data?: ShellySensorsResult }
  | { status: "live"; data: ShellySensorsResult }
  | { status: "error"; message: string; data?: ShellySensorsResult };

function shortAussenLabel(label: string): string {
  return label.replace(/^Aussen\s+/i, "") || label;
}

function AussenPairRow({
  pair,
  nowMs,
}: {
  pair: [ShellySensor, ShellySensor];
  nowMs: number | null;
}) {
  return (
    <li className="transition-opacity duration-300">
      <h3 className="subsection-heading">Aussen</h3>
      <div className="mt-3 grid grid-cols-2 gap-x-8">
        {pair.map((sensor) => {
          const age = formatRelativeAge(sensor.updatedAt, nowMs);
          const offline = !sensor.online;
          return (
            <div
              key={sensor.id}
              className={["min-w-0", offline ? "opacity-55" : undefined]
                .filter(Boolean)
                .join(" ")}
            >
              <p className="text-xs font-medium text-muted">
                {shortAussenLabel(sensor.label)}
                {offline ? (
                  <span className="ml-1.5 font-normal text-warning">
                    {sensor.updatedAt ? "veraltet" : "offline"}
                  </span>
                ) : null}
              </p>
              <p className="mt-0.5 text-[2.35rem] font-semibold leading-none tracking-tight tabular-nums">
                {formatTemp(sensor.temperatureC)}
              </p>
              <div className="mt-2 space-y-0.5 text-sm tabular-nums text-muted">
                <p>Luftfeuchtigkeit {formatHumidity(sensor.humidityPct)}</p>
                <p
                  className={[
                    "text-xs",
                    sensor.batteryPct !== null && sensor.batteryPct < 20
                      ? "text-warning"
                      : undefined,
                  ]
                    .filter(Boolean)
                    .join(" ")}
                >
                  Batterie {formatBattery(sensor.batteryPct)}
                </p>
              </div>
              {age ? (
                <p className="mt-1.5 text-[0.7rem] tabular-nums text-muted">
                  {age}
                </p>
              ) : null}
            </div>
          );
        })}
      </div>
    </li>
  );
}

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
        "transition-opacity duration-300",
        offline ? "opacity-55" : undefined,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <h3 className="subsection-heading">{sensor.label}</h3>
      <div className="mt-3 grid grid-cols-[1fr_auto] items-end gap-x-4 gap-y-1">
        <div>
          {offline ? (
            <p className="mb-1 text-xs text-warning">
              {sensor.updatedAt ? "veraltet" : "offline"}
            </p>
          ) : null}
          <p className="text-[2.35rem] font-semibold leading-none tracking-tight tabular-nums">
            {formatTemp(sensor.temperatureC)}
          </p>
          {age ? (
            <p className="mt-1.5 text-[0.7rem] tabular-nums text-muted">{age}</p>
          ) : null}
        </div>
        <div className="pb-1 text-right text-sm tabular-nums text-muted">
          <p>Luftfeuchtigkeit {formatHumidity(sensor.humidityPct)}</p>
          <p
            className={[
              "text-xs",
              sensor.batteryPct !== null && sensor.batteryPct < 20
                ? "text-warning"
                : undefined,
            ]
              .filter(Boolean)
              .join(" ")}
          >
            Batterie {formatBattery(sensor.batteryPct)}
          </p>
        </div>
      </div>
    </li>
  );
}

function splitAussenPair(sensors: ShellySensor[]): {
  pair: [ShellySensor, ShellySensor] | null;
  rest: ShellySensor[];
} {
  const pairMembers = sensors.filter((s) => AUSSEN_LABELS.has(s.label));
  if (pairMembers.length === 2) {
    const pairLabels = new Set(pairMembers.map((s) => s.label));
    return {
      pair: [pairMembers[0], pairMembers[1]],
      rest: sensors.filter((s) => !pairLabels.has(s.label)),
    };
  }
  return { pair: null, rest: sensors };
}

function PlaceholderRows() {
  return (
    <ul className="mt-5 flex flex-col gap-6" aria-hidden>
      <li className="opacity-40">
        <h3 className="subsection-heading">Aussen</h3>
        <div className="mt-3 grid grid-cols-2 gap-x-8">
          {["EG", "DG"].map((short) => (
            <div key={short} className="min-w-0">
              <p className="text-xs font-medium text-muted">{short}</p>
              <p className="mt-0.5 text-[2.35rem] font-semibold leading-none tracking-tight tabular-nums">
                —
              </p>
              <div className="mt-2 space-y-0.5 text-sm text-muted">
                <p>Luftfeuchtigkeit —</p>
                <p className="text-xs">Batterie —</p>
              </div>
            </div>
          ))}
        </div>
      </li>
      {["Arbeitszimmer", "Wohnzimmer"].map((label) => (
        <li key={label} className="opacity-40">
          <h3 className="subsection-heading">{label}</h3>
          <div className="mt-3 grid grid-cols-[1fr_auto] items-end gap-x-4">
            <p className="text-[2.35rem] font-semibold leading-none tracking-tight tabular-nums">
              —
            </p>
            <div className="pb-1 text-right text-sm text-muted">
              <p>Luftfeuchtigkeit —</p>
              <p className="text-xs">Batterie —</p>
            </div>
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
    const id = window.setInterval(() => {
      if (!isPageHidden()) void load();
    }, POLL_MS);
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

  const { pair, rest } = sensors?.length
    ? splitAussenPair(sensors)
    : { pair: null, rest: [] as ShellySensor[] };

  return (
    <section aria-labelledby="sensors-heading">
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
        // Fade only the first paint of live values — list remounts once, not on polls.
        <ul className="mt-5 flex flex-col gap-6 animate-fade-in">
          {pair ? <AussenPairRow pair={pair} nowMs={nowMs} /> : null}
          {rest.map((sensor) => (
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
