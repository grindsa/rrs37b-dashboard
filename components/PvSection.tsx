"use client";

import { useEffect, useState } from "react";
import type { PvSnapshot } from "@/lib/pv";
import { formatRelativeAge } from "@/lib/format";
import { SectionMeta, sectionFeedStatus } from "./SectionMeta";

const POLL_MS = 30_000;

type LoadState =
  | { status: "loading"; data?: PvSnapshot }
  | { status: "live"; data: PvSnapshot }
  | { status: "error"; message: string; data?: PvSnapshot };

function formatWatts(w: number | null): string {
  if (w === null || !Number.isFinite(w)) return "—";
  return `${Math.round(w)} W`;
}

function formatSoc(pct: number | null): string {
  if (pct === null || !Number.isFinite(pct)) return "—";
  return `${Math.round(pct)} %`;
}

export function PvPlaceholder() {
  return (
    <section aria-hidden className="opacity-40">
      <p className="section-label">Photovoltaik</p>
      <ul className="mt-5 flex flex-col gap-5">
        {["Batterie SoC", "Solar", "Haus"].map((label) => (
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
    setNowMs(Date.now());
    const id = window.setInterval(() => setNowMs(Date.now()), 30_000);
    return () => window.clearInterval(id);
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

    void load();
    const id = window.setInterval(() => void load(), POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  const data = state.data;
  const feed = sectionFeedStatus({
    loading: state.status === "loading",
    hasData: Boolean(data),
    error: state.status === "error",
  });

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

      <ul className="mt-5 flex flex-col gap-5">
        <li>
          <p className="text-sm font-medium text-muted">Batterie SoC</p>
          <p className="mt-0.5 text-[2.35rem] font-semibold leading-none tracking-tight tabular-nums">
            {formatSoc(data?.socPct ?? null)}
          </p>
          <p className="mt-1 text-[0.7rem] text-muted">Growatt NOAH 2000</p>
        </li>
        <li>
          <p className="text-sm font-medium text-muted">Solar</p>
          <p className="mt-0.5 text-[2.35rem] font-semibold leading-none tracking-tight tabular-nums">
            {formatWatts(data?.solarW ?? null)}
          </p>
          <p className="mt-1 text-[0.7rem] text-muted">APsystems EZ1-M</p>
        </li>
        <li>
          <p className="text-sm font-medium text-muted">Haus</p>
          <p className="mt-0.5 text-[2.35rem] font-semibold leading-none tracking-tight tabular-nums">
            {formatWatts(data?.houseW ?? null)}
          </p>
          <p className="mt-1 text-[0.7rem] text-muted">Shelly Pro 3EM</p>
        </li>
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
