"use client";

import { useEffect, useRef, useState } from "react";
import {
  mergePvParts,
  type PvHouseSnapshot,
  type PvRestSnapshot,
  type PvSnapshot,
} from "@/lib/pv-types";
import { formatRelativeAge } from "@/lib/format";
import { isPageHidden, onForeground } from "@/lib/foreground-refresh";
import { SectionMeta, sectionFeedStatus } from "./SectionMeta";

const POLL_MS = 30_000;

type LoadState =
  | { status: "loading"; data?: PvSnapshot }
  | { status: "live"; data: PvSnapshot }
  | { status: "error"; message: string; data?: PvSnapshot };

async function fetchPvPart<T>(part: "house" | "rest"): Promise<T> {
  const res = await fetch(`/api/pv?part=${part}`, { cache: "no-store" });
  if (res.status === 401) {
    throw new Error("Nicht angemeldet");
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as T;
}

function formatWatts(w: number | null): string {
  if (w === null || !Number.isFinite(w)) return "—";
  return `${Math.round(w)} W`;
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
        <p className="text-sm font-medium text-muted">Einspeisung aus öffentlichem Stromnetz</p>
        <p className="mt-0.5 text-[2.75rem] font-semibold leading-none">—</p>
      </div>
      <ul className="mt-6 flex flex-col gap-5">
        {["Einspeisung aus Photovoltaik", "Batterie"].map((label) => (
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

  const houseRef = useRef<PvHouseSnapshot | null>(
    initialData
      ? {
          houseW: initialData.houseW,
          fetchedAt: initialData.fetchedAt,
          warnings: [],
        }
      : null,
  );
  const restRef = useRef<PvRestSnapshot | null>(
    initialData
      ? {
          socPct: initialData.socPct,
          chargeW: initialData.chargeW,
          dischargeW: initialData.dischargeW,
          solarW: initialData.solarW,
          fetchedAt: initialData.fetchedAt,
          warnings: initialData.warnings,
        }
      : null,
  );

  useEffect(() => {
    let cancelled = false;

    function publish() {
      if (cancelled) return;
      const data = mergePvParts(houseRef.current, restRef.current);
      const hasAny =
        data.houseW !== null ||
        data.solarW !== null ||
        data.socPct !== null ||
        data.warnings.length > 0;
      if (!hasAny && !houseRef.current && !restRef.current) return;
      setState({ status: "live", data });
    }

    async function load() {
      // Start both immediately; apply Shelly as soon as it returns so the
      // tab is usable while EZ1-M / NOAH may still be timing out.
      const housePromise = fetchPvPart<PvHouseSnapshot>("house")
        .then((house) => {
          houseRef.current = house;
          publish();
        })
        .catch((err: unknown) => {
          if (cancelled) return;
          const message = err instanceof Error ? err.message : "Fehler";
          if (message === "Nicht angemeldet") {
            setState((prev) => ({
              status: "error",
              message,
              data: prev.data,
            }));
            return;
          }
          if (!houseRef.current) {
            houseRef.current = {
              houseW: null,
              fetchedAt: new Date().toISOString(),
              warnings: [message],
            };
            publish();
          }
        });

      const restPromise = fetchPvPart<PvRestSnapshot>("rest")
        .then((rest) => {
          restRef.current = rest;
          publish();
        })
        .catch((err: unknown) => {
          if (cancelled) return;
          const message = err instanceof Error ? err.message : "Fehler";
          if (message === "Nicht angemeldet") {
            setState((prev) => ({
              status: "error",
              message,
              data: prev.data,
            }));
            return;
          }
          if (!restRef.current) {
            restRef.current = {
              socPct: null,
              chargeW: null,
              dischargeW: null,
              solarW: null,
              fetchedAt: new Date().toISOString(),
              warnings: [message],
            };
            publish();
          }
        });

      await Promise.allSettled([housePromise, restPromise]);

      if (
        !cancelled &&
        !houseRef.current &&
        !restRef.current
      ) {
        setState((prev) => ({
          status: "error",
          message: "PV-Daten nicht verfügbar",
          data: prev.data,
        }));
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
        <p className="text-sm font-medium text-muted">Einspeisung aus öffentlichem Stromnetz</p>
        <p className="mt-0.5 text-[2.75rem] font-semibold leading-none tracking-tight tabular-nums">
          {formatWatts(data?.houseW ?? null)}
        </p>
        <p className="mt-1 text-[0.7rem] text-muted">Shelly Pro 3EM</p>
      </div>

      <ul className="mt-6 flex flex-col gap-5">
        <li>
          <p className="text-sm font-medium text-muted">Einspeisung aus Photovoltaik</p>
          <p className="mt-0.5 text-[2.1rem] font-semibold leading-none tracking-tight tabular-nums">
            {formatWatts(data?.solarW ?? null)}
          </p>
          <p className="mt-1 text-[0.7rem] text-muted">APsystems EZ1-M</p>
        </li>
        <li>
          <p className="text-sm font-medium text-muted">Batterie</p>
          <p className="mt-0.5 text-[2.1rem] font-semibold leading-none tracking-tight tabular-nums">
            {formatSoc(data?.socPct ?? null)}
          </p>
          <p className="mt-1 text-[0.7rem] text-muted">
            Growatt NOAH 2000
            {flow ? ` · ${flow}` : ""}
          </p>
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
