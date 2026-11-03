"use client";

import { useEffect, useState } from "react";
import type { PvSnapshot } from "@/lib/pv";
import { formatRelativeAge } from "@/lib/format";
import { isPageHidden, onForeground } from "@/lib/foreground-refresh";
import { SectionMeta, sectionFeedStatus } from "./SectionMeta";

const POLL_MS = 30_000;

type LoadState =
  | { status: "loading"; data?: PvSnapshot }
  | { status: "live"; data: PvSnapshot }
  | { status: "error"; message: string; data?: PvSnapshot };

function formatWatts(w: number | null, signed = false): string {
  if (w === null || !Number.isFinite(w)) return "—";
  const rounded = Math.round(w);
  if (signed && rounded > 0) return `+${rounded} W`;
  return `${rounded} W`;
}

function formatSoc(pct: number | null): string {
  if (pct === null || !Number.isFinite(pct)) return "—";
  return `${Math.round(pct)} %`;
}

function batteryFlowLabel(data: PvSnapshot | undefined): string | null {
  if (!data) return null;
  const charge = data.chargeW;
  const discharge = data.dischargeW;
  if (charge !== null && charge > 1) return `Laden ${Math.round(charge)} W`;
  if (discharge !== null && discharge > 1) {
    return `Entladen ${Math.round(discharge)} W`;
  }
  return null;
}

export function PvPlaceholder() {
  return (
    <section aria-hidden className="opacity-40">
      <p className="section-label">Photovoltaik</p>
      <div className="mt-5">
        <p className="text-sm font-medium text-muted">Batterie</p>
        <p className="mt-0.5 text-[2.75rem] font-semibold leading-none">—</p>
      </div>
      <ul className="mt-6 flex flex-col gap-5">
        {["Erzeugung", "Hausverbrauch"].map((label) => (
          <li key={label}>
            <p className="text-sm font-medium text-muted">{label}</p>
            <p className="mt-0.5 text-[2.1rem] font-semibold leading-none">—</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function PvSection({ initialData }: { initialData?: PvSnapshot }) {
  const [state, setState] = useState<LoadState>(() =>
    initialData
      ? { status: "live", data: initialData }
      : { status: "loading" },
  );
  const [nowMs, setNowMs] = useState<number | null>(null);

  useEffect(() => {
    const tickNow = () => setNowMs(Date.now());
    tickNow();
    const id = window.setInterval(tickNow, 30_000);
    const stopFg = onForeground(tickNow);
    return () => {
      window.clearInterval(id);
      stopFg();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const res = await fetch("/api/pv", { cache: "no-store" });
        if (res.status === 401) {
          if (!cancelled) {
            setState((prev) => ({
              status: "error",
              message: "Nicht angemeldet",
              data: prev.data,
            }));
          }
          return;
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as PvSnapshot;
        if (!cancelled) setState({ status: "live", data });
      } catch (err) {
        if (!cancelled) {
          setState((prev) => ({
            status: "error",
            message: err instanceof Error ? err.message : "Fehler",
            data: prev.data,
          }));
        }
      }
    }

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
  const feed = sectionFeedStatus({
    loading: state.status === "loading",
    hasData: Boolean(
      data &&
        (data.socPct !== null || data.solarW !== null || data.houseW !== null),
    ),
    error: state.status === "error",
  });
  const flow = batteryFlowLabel(data);

  return (
    <section className="animate-fade-up" aria-labelledby="pv-heading">
      <div className="flex items-end justify-between gap-3">
        <h2 id="pv-heading" className="section-label">
          Photovoltaik
        </h2>
        <SectionMeta
          status={feed}
          fetchedAt={data?.fetchedAt}
          nowMs={nowMs}
        />
      </div>

      <div className="mt-5">
        <p className="text-sm font-medium text-muted">Batterie</p>
        <p className="mt-0.5 text-[2.75rem] font-semibold leading-none tracking-tight tabular-nums">
          {formatSoc(data?.socPct ?? null)}
        </p>
        <p className="mt-1 text-[0.7rem] text-muted">
          Growatt NOAH 2000
          {flow ? ` · ${flow}` : ""}
        </p>
      </div>

      <ul className="mt-6 flex flex-col gap-5">
        <li>
          <p className="text-sm font-medium text-muted">Erzeugung</p>
          <p className="mt-0.5 text-[2.1rem] font-semibold leading-none tracking-tight tabular-nums">
            {formatWatts(data?.solarW ?? null)}
          </p>
          <p className="mt-1 text-[0.7rem] text-muted">APsystems EZ1-M</p>
        </li>
        <li>
          <p className="text-sm font-medium text-muted">Hausverbrauch</p>
          <p className="mt-0.5 text-[2.1rem] font-semibold leading-none tracking-tight tabular-nums">
            {formatWatts(data?.houseW ?? null)}
          </p>
          <p className="mt-1 text-[0.7rem] text-muted">Shelly Pro 3EM</p>
        </li>
        {data?.netW !== null && data?.netW !== undefined ? (
          <li>
            <p className="text-sm font-medium text-muted">Saldo</p>
            <p className="mt-0.5 text-[2.1rem] font-semibold leading-none tracking-tight tabular-nums">
              {formatWatts(data.netW, true)}
            </p>
            <p className="mt-1 text-[0.7rem] text-muted">
              Erzeugung − Hausverbrauch
            </p>
          </li>
        ) : null}
      </ul>

      {data?.fetchedAt ? (
        <p className="mt-4 text-[0.7rem] tabular-nums text-muted">
          {formatRelativeAge(data.fetchedAt, nowMs) ?? "gerade eben"}
        </p>
      ) : null}

      {data?.warnings?.length ? (
        <ul className="mt-4 flex flex-col gap-1 text-[0.7rem] text-warning">
          {data.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
