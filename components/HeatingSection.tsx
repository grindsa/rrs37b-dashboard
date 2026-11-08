"use client";

import { useEffect, useRef, useState } from "react";
import type {
  HeatingGroupStatus,
  HeatingSnapshot,
  HeatingThermostatStatus,
} from "@/lib/heating";
import {
  SETPOINT_MAX_C,
  SETPOINT_MIN_C,
  SETPOINT_STEP_C,
  clampSetpointC,
} from "@/lib/heating-setpoint";
import { formatRelativeAge, formatTemp } from "@/lib/format";
import { isPageHidden, onForeground } from "@/lib/foreground-refresh";
import { SectionMeta, sectionFeedStatus } from "./SectionMeta";

const POLL_MS = 8_000;
/** Wait for more +/- clicks before posting the setpoint. */
const SETPOINT_DEBOUNCE_MS = 5_000;
/** BLE setpoint can take up to ~60s. */
const SETPOINT_FETCH_MS = 75_000;

type LoadState =
  | { status: "loading"; data?: HeatingSnapshot }
  | { status: "live"; data: HeatingSnapshot }
  | { status: "error"; message: string; data?: HeatingSnapshot };

type PendingSetpoint = {
  targetC: number;
  setAt: number;
  /** Local edits; API call starts after debounce. */
  phase: "draft" | "sending";
};

function setpointErrorMessage(code: string | undefined, fallback: string): string {
  switch (code) {
    case "ble_timeout":
      return "BLE-Timeout — Thermostat antwortet nicht";
    case "not_paired":
      return "Nicht gekoppelt";
    case "ble_error":
      return "BLE-Fehler";
    case "ble_disabled":
      return "BLE deaktiviert am Proxy";
    case "not_found":
      return "Thermostat nicht gefunden";
    case "unauthorized":
      return "Proxy-Auth fehlgeschlagen";
    case "not_configured":
      return "Heizung-Proxy nicht konfiguriert";
    default:
      return fallback || "Sollwert setzen fehlgeschlagen";
  }
}

function BluetoothIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d="M7 7l10 10-5 5V2l5 5L7 17" />
    </svg>
  );
}

function SetpointControls({
  name,
  setpointC,
  enabled,
  sending,
  onStep,
}: {
  name: string;
  setpointC: number | null;
  enabled: boolean;
  /** True while the REST/BLE write is in flight. */
  sending: boolean;
  onStep: (delta: number) => void;
}) {
  const display =
    setpointC === null || !Number.isFinite(setpointC)
      ? "—"
      : formatTemp(setpointC);
  const buttonsEnabled = enabled && !sending;

  return (
    <div className="flex items-center gap-px">
      <button
        type="button"
        disabled={!buttonsEnabled}
        aria-label={`${name} Soll −0,5°`}
        onClick={() => onStep(-SETPOINT_STEP_C)}
        className={[
          "inline-flex h-7 w-7 items-center justify-center rounded-full border text-sm leading-none transition-colors",
          buttonsEnabled
            ? "border-accent/40 text-accent hover:bg-accent-soft/40"
            : "border-hairline text-muted/40",
        ].join(" ")}
      >
        −
      </button>
      <div className="min-w-[2.75rem] px-0.5 text-center">
        <p className="text-[0.6rem] uppercase tracking-wide text-muted">Soll</p>
        <p
          className={[
            "text-sm font-semibold tabular-nums leading-none",
            sending ? "text-muted" : "text-foreground",
          ].join(" ")}
        >
          {display}
          {sending ? (
            <span className="ml-0.5 text-[0.6rem] font-normal text-muted">
              …
            </span>
          ) : null}
        </p>
      </div>
      <button
        type="button"
        disabled={!buttonsEnabled}
        aria-label={`${name} Soll +0,5°`}
        onClick={() => onStep(SETPOINT_STEP_C)}
        className={[
          "inline-flex h-7 w-7 items-center justify-center rounded-full border text-sm leading-none transition-colors",
          buttonsEnabled
            ? "border-accent/40 text-accent hover:bg-accent-soft/40"
            : "border-hairline text-muted/40",
        ].join(" ")}
      >
        +
      </button>
    </div>
  );
}

function ThermostatRow({
  thermostat,
  nowMs,
  pending,
  actionError,
  onStep,
}: {
  thermostat: HeatingThermostatStatus;
  nowMs: number | null;
  pending?: PendingSetpoint;
  actionError?: string;
  onStep: (delta: number) => void;
}) {
  const paired = thermostat.paired === true;
  const controlsEnabled = paired && thermostat.online;
  const shownSetpoint =
    pending?.targetC ??
    (thermostat.setpointC !== null && Number.isFinite(thermostat.setpointC)
      ? thermostat.setpointC
      : null);
  const age = formatRelativeAge(thermostat.lastSeenAt, nowMs);
  const statusParts = [
    thermostat.online ? "online" : "offline",
    age,
  ].filter(Boolean);

  return (
    <li className="border-t border-hairline pt-3 first:border-t-0 first:pt-0">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <p className="truncate text-sm font-medium text-foreground">
              {thermostat.name}
            </p>
            <span
              className={paired ? "text-muted" : "text-muted/35"}
              title={paired ? "gekoppelt" : "nicht gekoppelt"}
              aria-label={paired ? "gekoppelt" : "nicht gekoppelt"}
            >
              <BluetoothIcon className="h-3.5 w-3.5" />
            </span>
          </div>
          <p
            className={[
              "mt-0.5 text-[0.55rem] leading-snug",
              thermostat.online ? "text-muted" : "text-warning",
            ].join(" ")}
          >
            {statusParts.join(" · ")}
          </p>
          {thermostat.error ? (
            <p className="mt-1 text-xs text-warning">{thermostat.error}</p>
          ) : null}
          {actionError ? (
            <p className="mt-1 text-xs text-warning">{actionError}</p>
          ) : null}
        </div>

        <div className="flex shrink-0 items-center gap-4">
          <div className="min-w-[3.5rem] text-right">
            <p className="text-[0.65rem] uppercase tracking-wide text-muted">
              Ist
            </p>
            <p className="text-lg font-semibold tabular-nums leading-none text-foreground">
              {formatTemp(thermostat.temperatureC)}
            </p>
          </div>
          <SetpointControls
            name={thermostat.name}
            setpointC={shownSetpoint}
            enabled={controlsEnabled}
            sending={pending?.phase === "sending"}
            onStep={onStep}
          />
        </div>
      </div>
    </li>
  );
}

function GroupBlock({
  group,
  nowMs,
  pendingById,
  actionErrors,
  onStep,
}: {
  group: HeatingGroupStatus;
  nowMs: number | null;
  pendingById: Record<string, PendingSetpoint>;
  actionErrors: Record<string, string>;
  onStep: (id: string, delta: number) => void;
}) {
  return (
    <section aria-labelledby={`heating-group-${group.id}`}>
      <h2
        id={`heating-group-${group.id}`}
        className="text-base font-semibold tracking-tight"
      >
        {group.name}
      </h2>
      <ul className="mt-3 flex flex-col gap-3">
        {group.thermostats.map((t) => (
          <ThermostatRow
            key={t.id}
            thermostat={t}
            nowMs={nowMs}
            pending={pendingById[t.id]}
            actionError={actionErrors[t.id]}
            onStep={(delta) => onStep(t.id, delta)}
          />
        ))}
      </ul>
    </section>
  );
}

function findThermostat(
  data: HeatingSnapshot | undefined,
  id: string,
): HeatingThermostatStatus | undefined {
  if (!data) return undefined;
  for (const group of data.groups) {
    const hit = group.thermostats.find((t) => t.id === id);
    if (hit) return hit;
  }
  return undefined;
}

function patchThermostat(
  data: HeatingSnapshot,
  next: HeatingThermostatStatus,
): HeatingSnapshot {
  return {
    ...data,
    groups: data.groups.map((group) => ({
      ...group,
      thermostats: group.thermostats.map((t) =>
        t.id === next.id ? { ...t, ...next } : t,
      ),
    })),
  };
}

export function HeatingPlaceholder() {
  return (
    <section aria-hidden className="opacity-40">
      <div className="flex items-baseline justify-between gap-3">
        <p className="section-label">Heizung</p>
      </div>
      <p className="mt-5 text-sm text-muted">—</p>
    </section>
  );
}

export function HeatingSection() {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [nowMs, setNowMs] = useState<number | null>(null);
  const [pendingById, setPendingById] = useState<Record<string, PendingSetpoint>>(
    {},
  );
  const [actionErrors, setActionErrors] = useState<Record<string, string>>({});
  const pendingRef = useRef(pendingById);
  pendingRef.current = pendingById;
  const stateRef = useRef(state);
  stateRef.current = state;
  const debounceTimersRef = useRef<Record<string, number>>({});

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
    const timers = debounceTimersRef.current;
    return () => {
      for (const timer of Object.values(timers)) {
        window.clearTimeout(timer);
      }
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;

    async function load() {
      try {
        const res = await fetch("/api/heating", {
          cache: "no-store",
          signal: AbortSignal.timeout(15_000),
        });
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
        const data = (await res.json()) as HeatingSnapshot;
        if (cancelled) return;
        if (!res.ok && !data.groups) {
          setState((prev) => ({
            status: "error",
            message: data.error ?? `HTTP ${res.status}`,
            data: prev.data,
          }));
          return;
        }
        if (data.error) {
          setState({
            status: "error",
            message: data.error,
            data,
          });
          return;
        }
        setState({ status: "live", data });
      } catch (err) {
        if (!cancelled) {
          const aborted =
            err instanceof DOMException && err.name === "TimeoutError";
          setState((prev) => ({
            status: "error",
            message: aborted
              ? "Heizung-Status Timeout"
              : err instanceof Error
                ? err.message
                : "Fehler",
            data: prev.data,
          }));
        }
      }
    }

    function scheduleNext() {
      timer = window.setTimeout(() => {
        if (isPageHidden()) {
          scheduleNext();
          return;
        }
        void load().finally(() => {
          if (!cancelled) scheduleNext();
        });
      }, POLL_MS);
    }

    void load().finally(() => {
      if (!cancelled) scheduleNext();
    });

    const stopFg = onForeground(() => {
      if (!cancelled) void load();
    });

    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
      stopFg();
    };
  }, []);

  function clearDebounceTimer(id: string) {
    const timer = debounceTimersRef.current[id];
    if (timer !== undefined) {
      window.clearTimeout(timer);
      delete debounceTimersRef.current[id];
    }
  }

  async function commitSetpoint(id: string) {
    clearDebounceTimer(id);
    const draft = pendingRef.current[id];
    if (!draft || draft.phase !== "draft") return;

    const targetC = draft.targetC;
    setPendingById((prev) => ({
      ...prev,
      [id]: { ...draft, phase: "sending", setAt: Date.now() },
    }));

    try {
      const res = await fetch("/api/heating/setpoint", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        signal: AbortSignal.timeout(SETPOINT_FETCH_MS),
        body: JSON.stringify({ id, celsius: targetC }),
      });
      const body = (await res.json()) as {
        ok?: boolean;
        thermostat?: HeatingThermostatStatus;
        error?: string;
        code?: string;
      };

      if (!res.ok || !body.ok) {
        setActionErrors((prev) => ({
          ...prev,
          [id]: setpointErrorMessage(
            body.code,
            body.error ?? `HTTP ${res.status}`,
          ),
        }));
        return;
      }

      if (body.thermostat) {
        setState((prev) => {
          if (!prev.data) return prev;
          return {
            status: "live",
            data: patchThermostat(prev.data, body.thermostat!),
          };
        });
      } else {
        setState((prev) => {
          if (!prev.data) return prev;
          const existing = findThermostat(prev.data, id);
          if (!existing) return prev;
          return {
            ...prev,
            data: patchThermostat(prev.data, {
              ...existing,
              setpointC: targetC,
            }),
          };
        });
      }
    } catch (err) {
      const aborted =
        err instanceof DOMException && err.name === "TimeoutError";
      setActionErrors((prev) => ({
        ...prev,
        [id]: aborted
          ? "BLE-Timeout — bitte erneut versuchen"
          : err instanceof Error
            ? err.message
            : "Sollwert setzen fehlgeschlagen",
      }));
    } finally {
      setPendingById((prev) => {
        if (!prev[id] || prev[id].phase !== "sending") return prev;
        const next = { ...prev };
        delete next[id];
        return next;
      });
    }
  }

  function scheduleSetpoint(id: string, delta: number) {
    const existing = pendingRef.current[id];
    if (existing?.phase === "sending") return;

    const current = findThermostat(stateRef.current.data, id);
    if (!current || current.paired !== true || !current.online) return;

    const base =
      existing?.phase === "draft"
        ? existing.targetC
        : current.setpointC !== null && Number.isFinite(current.setpointC)
          ? current.setpointC
          : 21;
    const targetC = clampSetpointC(base + delta);
    if (Math.abs(base - targetC) < 0.05) return;
    if (targetC < SETPOINT_MIN_C || targetC > SETPOINT_MAX_C) return;

    setPendingById((prev) => ({
      ...prev,
      [id]: { targetC, setAt: Date.now(), phase: "draft" },
    }));
    setActionErrors((prev) => {
      if (!prev[id]) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });

    clearDebounceTimer(id);
    debounceTimersRef.current[id] = window.setTimeout(() => {
      delete debounceTimersRef.current[id];
      void commitSetpoint(id);
    }, SETPOINT_DEBOUNCE_MS);
  }

  const data = state.data;
  const feed = sectionFeedStatus({
    loading: state.status === "loading",
    hasData: Boolean(data),
    error: state.status === "error",
  });
  const warnings = data?.warnings ?? [];
  const groups = data?.groups ?? [];
  const emptyConfigured =
    state.status === "live" &&
    data?.configured &&
    groups.length === 0 &&
    warnings.length === 0 &&
    !data.error;

  return (
    <section>
      <div className="flex items-baseline justify-between gap-3">
        <p className="section-label">Heizung</p>
        <SectionMeta
          status={feed}
          fetchedAt={data?.fetchedAt}
          nowMs={nowMs}
        />
      </div>

      {warnings.length > 0 ? (
        <ul className="mt-3 flex flex-col gap-1">
          {warnings.map((w) => (
            <li key={w} className="text-xs text-warning">
              {w}
            </li>
          ))}
        </ul>
      ) : null}

      {state.status === "error" && !data?.groups?.length ? (
        <p className="mt-5 text-sm text-warning">
          {state.message || "Heizung nicht erreichbar"}
        </p>
      ) : null}

      {emptyConfigured ? (
        <p className="mt-5 text-sm text-muted">
          Keine Thermostate in der Config / API.
        </p>
      ) : null}

      {groups.length > 0 ? (
        <div className="mt-5 flex flex-col gap-8">
          {groups.map((group) => (
            <GroupBlock
              key={group.id}
              group={group}
              nowMs={nowMs}
              pendingById={pendingById}
              actionErrors={actionErrors}
              onStep={(id, delta) => scheduleSetpoint(id, delta)}
            />
          ))}
        </div>
      ) : state.status === "loading" ? (
        <p className="mt-5 text-sm text-muted">Laden…</p>
      ) : null}
    </section>
  );
}
