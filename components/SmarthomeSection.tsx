"use client";

import { useEffect, useRef, useState } from "react";
import type {
  CoverAction,
  CoverDeviceStatus,
  PlugDeviceStatus,
  SmarthomeGroupStatus,
  SmarthomeSnapshot,
} from "@/lib/smarthome";
import { isPageHidden, onForeground } from "@/lib/foreground-refresh";
import { SectionMeta, sectionFeedStatus } from "./SectionMeta";

const POLL_IDLE_MS = 30_000;
const POLL_MOVING_MS = 5_000;

type LoadState =
  | { status: "loading"; data?: SmarthomeSnapshot }
  | { status: "live"; data: SmarthomeSnapshot }
  | { status: "error"; message: string; data?: SmarthomeSnapshot };

function coverStatusLabel(cover: CoverDeviceStatus): string {
  if (!cover.online) {
    return cover.error ? `offline · ${cover.error}` : "offline";
  }
  switch (cover.state) {
    case "opening":
      return cover.positionPct !== null
        ? `öffnet · ${cover.positionPct} % offen`
        : "öffnet";
    case "closing":
      return cover.positionPct !== null
        ? `schließt · ${cover.positionPct} % offen`
        : "schließt";
    case "open":
      return "offen";
    case "closed":
      return "geschlossen";
    case "stopped":
      return cover.positionPct !== null
        ? `gestoppt · ${cover.positionPct} % offen`
        : "gestoppt";
    default:
      return cover.positionPct !== null
        ? `${cover.positionPct} % offen`
        : "Status unbekannt";
  }
}

type CoverMotionUi = "opening" | "closing" | null;

/** Optimistic motion until Shelly status catches up (avoids pause→arrow flash). */
type MotionOverride = {
  motion: "opening" | "closing";
  setAt: number;
  startPos: number | null;
};

const OVERRIDE_GIVE_UP_MS = 15_000;
const OVERRIDE_MAX_MS = 180_000;

function isIdleCoverState(state: CoverDeviceStatus["state"]): boolean {
  return (
    state === "open" ||
    state === "closed" ||
    state === "stopped" ||
    state === "unknown"
  );
}

function resolveCoverMotion(
  state: CoverDeviceStatus["state"],
  override: MotionOverride | undefined,
): CoverMotionUi {
  if (state === "opening") return "opening";
  if (state === "closing") return "closing";
  if (override) return override.motion;
  return null;
}

function resolveGroupMotion(
  covers: CoverDeviceStatus[],
  override: MotionOverride | undefined,
): CoverMotionUi {
  if (covers.some((c) => c.state === "opening")) return "opening";
  if (covers.some((c) => c.state === "closing")) return "closing";
  if (override) return override.motion;
  return null;
}

function findCoverInSnapshot(
  data: SmarthomeSnapshot | undefined,
  coverId: string,
): CoverDeviceStatus | undefined {
  if (!data) return undefined;
  for (const group of data.groups) {
    const hit = group.covers.find((c) => c.id === coverId);
    if (hit) return hit;
  }
  return undefined;
}

/** Drop overrides once device status owns the UI (or command clearly finished/failed). */
function reconcileMotionOverrides(
  overrides: Record<string, MotionOverride>,
  lookup: (id: string) => CoverDeviceStatus[] | CoverDeviceStatus | undefined,
): Record<string, MotionOverride> {
  const now = Date.now();
  let changed = false;
  const next = { ...overrides };

  for (const [id, override] of Object.entries(overrides)) {
    const target = lookup(id);
    const covers = !target
      ? []
      : Array.isArray(target)
        ? target
        : [target];
    const age = now - override.setAt;

    if (covers.length === 0) {
      delete next[id];
      changed = true;
      continue;
    }

    const deviceMoving = covers.some(
      (c) => c.state === "opening" || c.state === "closing",
    );
    if (deviceMoving) {
      // Live status drives the pause icon now.
      delete next[id];
      changed = true;
      continue;
    }

    if (age > OVERRIDE_MAX_MS) {
      delete next[id];
      changed = true;
      continue;
    }

    const allIdle = covers.every((c) => isIdleCoverState(c.state));
    if (!allIdle) continue;

    const posChanged = covers.some((c) => {
      if (override.startPos === null || c.positionPct === null) return false;
      return c.positionPct !== override.startPos;
    });
    // Finished while we missed the "closing/opening" poll window.
    if (posChanged) {
      delete next[id];
      changed = true;
      continue;
    }
    // Never started (or status never flipped) — drop after a grace period.
    if (age > OVERRIDE_GIVE_UP_MS) {
      delete next[id];
      changed = true;
    }
  }

  return changed ? next : overrides;
}

function IconUp({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
      className={className}
    >
      <path
        d="M12 5.5v13M12 5.5l-5.5 5.5M12 5.5l5.5 5.5"
        stroke="currentColor"
        strokeWidth="1.85"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconDown({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
      className={className}
    >
      <path
        d="M12 18.5v-13M12 18.5l-5.5-5.5M12 18.5l5.5-5.5"
        stroke="currentColor"
        strokeWidth="1.85"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconPause({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
      className={className}
    >
      <path
        d="M9 7v10M15 7v10"
        stroke="currentColor"
        strokeWidth="2.1"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconPower({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
      className={className}
    >
      <path
        d="M12 3.5v8.5"
        stroke="currentColor"
        strokeWidth="1.85"
        strokeLinecap="round"
      />
      <path
        d="M7.2 6.6a7 7 0 1 0 9.6 0"
        stroke="currentColor"
        strokeWidth="1.85"
        strokeLinecap="round"
      />
    </svg>
  );
}

/**
 * Shelly-style ↑ / ↓ pill. While a direction is active, that side becomes
 * pause (Cover.Stop); after motion ends it returns to the arrow.
 */
function CoverControlPill({
  motion,
  onAction,
  disabled,
  openLabel,
  closeLabel,
  stopOpenLabel,
  stopCloseLabel,
}: {
  motion: CoverMotionUi;
  onAction: (action: CoverAction) => void;
  disabled?: boolean;
  openLabel: string;
  closeLabel: string;
  stopOpenLabel: string;
  stopCloseLabel: string;
}) {
  const openIsPause = motion === "opening";
  const closeIsPause = motion === "closing";
  const btnBase =
    "flex h-10 w-10 items-center justify-center rounded-full bg-background text-accent transition-[box-shadow,opacity] duration-200 disabled:opacity-45";
  const btnActive = "ring-2 ring-accent ring-offset-2 ring-offset-background";

  return (
    <div className="inline-flex shrink-0 items-center gap-1 rounded-full bg-surface p-1">
      <button
        type="button"
        disabled={disabled}
        aria-label={openIsPause ? stopOpenLabel : openLabel}
        aria-pressed={openIsPause}
        onClick={(e) => {
          e.stopPropagation();
          onAction(openIsPause ? "stop" : "open");
        }}
        className={[btnBase, openIsPause ? btnActive : undefined]
          .filter(Boolean)
          .join(" ")}
      >
        {openIsPause ? (
          <IconPause className="h-5 w-5" />
        ) : (
          <IconUp className="h-5 w-5" />
        )}
      </button>
      <button
        type="button"
        disabled={disabled}
        aria-label={closeIsPause ? stopCloseLabel : closeLabel}
        aria-pressed={closeIsPause}
        onClick={(e) => {
          e.stopPropagation();
          onAction(closeIsPause ? "stop" : "close");
        }}
        className={[btnBase, closeIsPause ? btnActive : undefined]
          .filter(Boolean)
          .join(" ")}
      >
        {closeIsPause ? (
          <IconPause className="h-5 w-5" />
        ) : (
          <IconDown className="h-5 w-5" />
        )}
      </button>
    </div>
  );
}

function CoverRow({
  cover,
  onAction,
  motionOverride,
  actionError,
}: {
  cover: CoverDeviceStatus;
  onAction: (action: CoverAction) => void;
  motionOverride?: MotionOverride;
  actionError?: string;
}) {
  const motion = resolveCoverMotion(cover.state, motionOverride);
  const controlsDisabled = !cover.online && cover.state === "unknown";

  return (
    <li className="border-t border-hairline pt-3 first:border-t-0 first:pt-0">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground">{cover.name}</p>
          <p
            className={[
              "mt-0.5 text-xs",
              cover.online ? "text-muted" : "text-warning",
            ].join(" ")}
          >
            {coverStatusLabel(cover)}
          </p>
          {actionError ? (
            <p className="mt-1 text-xs text-warning">{actionError}</p>
          ) : null}
        </div>
        <CoverControlPill
          motion={motion}
          onAction={onAction}
          disabled={controlsDisabled}
          openLabel={`${cover.name} auf`}
          closeLabel={`${cover.name} zu`}
          stopOpenLabel={`${cover.name} stoppen`}
          stopCloseLabel={`${cover.name} stoppen`}
        />
      </div>
    </li>
  );
}

function GroupBlock({
  group,
  onGroupAction,
  onCoverAction,
  groupMotionOverride,
  coverMotionOverrides,
  actionErrors,
}: {
  group: SmarthomeGroupStatus;
  onGroupAction: (groupId: string, action: CoverAction) => void;
  onCoverAction: (coverId: string, action: CoverAction) => void;
  groupMotionOverride?: MotionOverride;
  coverMotionOverrides: Record<string, MotionOverride>;
  actionErrors: Record<string, string>;
}) {
  const [expanded, setExpanded] = useState(false);
  const groupMotion = resolveGroupMotion(group.covers, groupMotionOverride);
  const coverCount = group.covers.length;

  return (
    <section aria-labelledby={`smarthome-group-${group.id}`}>
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={`smarthome-group-covers-${group.id}`}
          onClick={() => setExpanded((v) => !v)}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          <span className="text-xs text-muted" aria-hidden>
            {expanded ? "▾" : "▸"}
          </span>
          <span className="min-w-0">
            <span
              id={`smarthome-group-${group.id}`}
              className="block text-base font-semibold tracking-tight"
            >
              {group.name}
            </span>
            <span className="mt-0.5 block text-xs text-muted">
              {coverCount === 1 ? "1 Rollo" : `${coverCount} Rollos`}
              {expanded ? "" : " · antippen für Details"}
            </span>
          </span>
        </button>
        <CoverControlPill
          motion={groupMotion}
          onAction={(action) => onGroupAction(group.id, action)}
          openLabel={`${group.name} alle auf`}
          closeLabel={`${group.name} alle zu`}
          stopOpenLabel={`${group.name} stoppen`}
          stopCloseLabel={`${group.name} stoppen`}
        />
      </div>
      {actionErrors[`group:${group.id}`] ? (
        <p className="mt-2 text-xs text-warning">
          {actionErrors[`group:${group.id}`]}
        </p>
      ) : null}

      {expanded ? (
        <ul
          id={`smarthome-group-covers-${group.id}`}
          className="mt-4 flex flex-col gap-3"
        >
          {group.covers.map((cover) => (
            <CoverRow
              key={cover.id}
              cover={cover}
              onAction={(action) => onCoverAction(cover.id, action)}
              motionOverride={coverMotionOverrides[cover.id]}
              actionError={actionErrors[`cover:${cover.id}`]}
            />
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function PlugRow({
  plug,
  busy,
  error,
  onToggle,
}: {
  plug: PlugDeviceStatus;
  busy: boolean;
  error?: string;
  onToggle: (next: boolean) => void;
}) {
  const checked = plug.on === true;
  const unknown = plug.on === null;

  return (
    <li className="flex items-center justify-between gap-4">
      <div className="min-w-0">
        <p className="text-sm font-medium text-foreground">{plug.name}</p>
        <p
          className={[
            "mt-0.5 text-xs",
            plug.online ? "text-muted" : "text-warning",
          ].join(" ")}
        >
          {!plug.online
            ? plug.error
              ? `offline · ${plug.error}`
              : "offline"
            : unknown
              ? "Status unbekannt"
              : checked
                ? "ein"
                : "aus"}
        </p>
        {error ? <p className="mt-1 text-xs text-warning">{error}</p> : null}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-pressed={checked}
        aria-label={`${plug.name} ${checked ? "ausschalten" : "einschalten"}`}
        disabled={busy || !plug.online || unknown}
        onClick={() => onToggle(!checked)}
        className={[
          "flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-accent transition-[box-shadow,opacity] duration-200 disabled:opacity-45",
          checked
            ? "bg-background ring-2 ring-accent ring-offset-2 ring-offset-background"
            : "bg-surface",
        ].join(" ")}
      >
        <IconPower className="h-5 w-5" />
      </button>
    </li>
  );
}

export function SmarthomePlaceholder() {
  return (
    <section aria-hidden className="opacity-40">
      <p className="section-label">Smarthome</p>
      <p className="mt-5 text-sm text-muted">Laden…</p>
    </section>
  );
}

export function SmarthomeSection({
  initialData,
}: {
  initialData?: SmarthomeSnapshot;
}) {
  const [state, setState] = useState<LoadState>(() =>
    initialData
      ? { status: "live", data: initialData }
      : { status: "loading" },
  );
  const [nowMs, setNowMs] = useState<number | null>(null);
  const [coverMotionOverrides, setCoverMotionOverrides] = useState<
    Record<string, MotionOverride>
  >({});
  const [groupMotionOverrides, setGroupMotionOverrides] = useState<
    Record<string, MotionOverride>
  >({});
  const [plugBusyId, setPlugBusyId] = useState<string | null>(null);
  const [actionErrors, setActionErrors] = useState<Record<string, string>>({});
  const anyMovingRef = useRef(Boolean(initialData?.anyMoving));
  const coverOverridesRef = useRef(coverMotionOverrides);
  const groupOverridesRef = useRef(groupMotionOverrides);
  coverOverridesRef.current = coverMotionOverrides;
  groupOverridesRef.current = groupMotionOverrides;

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
    let timer: number | undefined;

    async function load() {
      try {
        const res = await fetch("/api/smarthome", { cache: "no-store" });
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
        const data = (await res.json()) as SmarthomeSnapshot & {
          error?: string;
        };
        if (cancelled) return;
        if (!res.ok) {
          setState((prev) => ({
            status: "error",
            message: data.error ?? `HTTP ${res.status}`,
            data: data.groups ? data : prev.data,
          }));
          return;
        }
        setCoverMotionOverrides((prev) =>
          reconcileMotionOverrides(prev, (id) => findCoverInSnapshot(data, id)),
        );
        setGroupMotionOverrides((prev) =>
          reconcileMotionOverrides(prev, (id) => {
            const group = data.groups.find((g) => g.id === id);
            return group?.covers;
          }),
        );
        const hasOverride =
          Object.keys(coverOverridesRef.current).length > 0 ||
          Object.keys(groupOverridesRef.current).length > 0;
        anyMovingRef.current = data.anyMoving || hasOverride;
        setState({ status: "live", data });
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

    function scheduleNext() {
      const hasOverride =
        Object.keys(coverOverridesRef.current).length > 0 ||
        Object.keys(groupOverridesRef.current).length > 0;
      const delay =
        anyMovingRef.current || hasOverride ? POLL_MOVING_MS : POLL_IDLE_MS;
      timer = window.setTimeout(() => {
        if (isPageHidden()) {
          scheduleNext();
          return;
        }
        void load().finally(() => {
          if (!cancelled) scheduleNext();
        });
      }, delay);
    }

    if (!initialData) {
      void load().finally(() => {
        if (!cancelled) scheduleNext();
      });
    } else {
      scheduleNext();
    }

    const stopFg = onForeground(() => void load());

    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
      stopFg();
    };
  }, [initialData]);

  async function refreshSoon() {
    try {
      // Brief delay so Shelly can flip to opening/closing before we read status.
      await new Promise((r) => window.setTimeout(r, 400));
      const res = await fetch("/api/smarthome", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as SmarthomeSnapshot;
      setCoverMotionOverrides((prev) =>
        reconcileMotionOverrides(prev, (id) => findCoverInSnapshot(data, id)),
      );
      setGroupMotionOverrides((prev) =>
        reconcileMotionOverrides(prev, (id) => {
          const group = data.groups.find((g) => g.id === id);
          return group?.covers;
        }),
      );
      const hasOverride =
        Object.keys(coverOverridesRef.current).length > 0 ||
        Object.keys(groupOverridesRef.current).length > 0;
      anyMovingRef.current = data.anyMoving || hasOverride;
      setState({ status: "live", data });
    } catch {
      /* keep last good snapshot */
    }
  }

  async function postGroup(groupId: string, action: CoverAction) {
    const group = state.data?.groups.find((g) => g.id === groupId);
    const startPos = group?.covers[0]?.positionPct ?? null;

    if (action === "open" || action === "close") {
      setGroupMotionOverrides((prev) => ({
        ...prev,
        [groupId]: {
          motion: action === "open" ? "opening" : "closing",
          setAt: Date.now(),
          startPos,
        },
      }));
      anyMovingRef.current = true;
    } else if (action === "stop") {
      setGroupMotionOverrides((prev) => {
        const next = { ...prev };
        delete next[groupId];
        return next;
      });
    }

    setActionErrors((prev) => {
      const next = { ...prev };
      delete next[`group:${groupId}`];
      return next;
    });
    try {
      const res = await fetch("/api/smarthome/group", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ groupId, action }),
      });
      const payload = (await res.json()) as {
        error?: string;
        results?: { id: string; ok: boolean; error?: string }[];
      };
      if (!res.ok && res.status !== 207) {
        setGroupMotionOverrides((prev) => {
          const next = { ...prev };
          delete next[groupId];
          return next;
        });
        setActionErrors((prev) => ({
          ...prev,
          [`group:${groupId}`]: payload.error ?? `HTTP ${res.status}`,
        }));
      } else if (payload.results?.some((r) => !r.ok)) {
        const failed = payload.results
          .filter((r) => !r.ok)
          .map((r) => r.error ?? r.id)
          .join("; ");
        setActionErrors((prev) => ({
          ...prev,
          [`group:${groupId}`]: failed || "Teilfehler",
        }));
      }
      await refreshSoon();
    } catch (err) {
      setGroupMotionOverrides((prev) => {
        const next = { ...prev };
        delete next[groupId];
        return next;
      });
      setActionErrors((prev) => ({
        ...prev,
        [`group:${groupId}`]:
          err instanceof Error ? err.message : "Gruppenbefehl fehlgeschlagen",
      }));
    }
  }

  async function postCover(coverId: string, action: CoverAction) {
    const cover = findCoverInSnapshot(state.data, coverId);

    if (action === "open" || action === "close") {
      setCoverMotionOverrides((prev) => ({
        ...prev,
        [coverId]: {
          motion: action === "open" ? "opening" : "closing",
          setAt: Date.now(),
          startPos: cover?.positionPct ?? null,
        },
      }));
      anyMovingRef.current = true;
    } else if (action === "stop") {
      setCoverMotionOverrides((prev) => {
        const next = { ...prev };
        delete next[coverId];
        return next;
      });
    }

    setActionErrors((prev) => {
      const next = { ...prev };
      delete next[`cover:${coverId}`];
      return next;
    });
    try {
      const res = await fetch("/api/smarthome/cover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ coverId, action }),
      });
      const payload = (await res.json()) as {
        error?: string;
        result?: { ok: boolean; error?: string };
      };
      if (!res.ok || payload.result?.ok === false) {
        setCoverMotionOverrides((prev) => {
          const next = { ...prev };
          delete next[coverId];
          return next;
        });
        setActionErrors((prev) => ({
          ...prev,
          [`cover:${coverId}`]:
            payload.result?.error ?? payload.error ?? `HTTP ${res.status}`,
        }));
      }
      await refreshSoon();
    } catch (err) {
      setCoverMotionOverrides((prev) => {
        const next = { ...prev };
        delete next[coverId];
        return next;
      });
      setActionErrors((prev) => ({
        ...prev,
        [`cover:${coverId}`]:
          err instanceof Error ? err.message : "Cover-Befehl fehlgeschlagen",
      }));
    }
  }

  async function postPlug(plugId: string, on: boolean) {
    setPlugBusyId(plugId);
    setActionErrors((prev) => {
      const next = { ...prev };
      delete next[`plug:${plugId}`];
      return next;
    });
    try {
      const res = await fetch("/api/smarthome/plug", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plugId, on }),
      });
      const payload = (await res.json()) as {
        error?: string;
        result?: { ok: boolean; error?: string };
      };
      if (!res.ok || payload.result?.ok === false) {
        setActionErrors((prev) => ({
          ...prev,
          [`plug:${plugId}`]:
            payload.result?.error ?? payload.error ?? `HTTP ${res.status}`,
        }));
      }
      await refreshSoon();
    } catch (err) {
      setActionErrors((prev) => ({
        ...prev,
        [`plug:${plugId}`]:
          err instanceof Error ? err.message : "Plug-Befehl fehlgeschlagen",
      }));
    } finally {
      setPlugBusyId(null);
    }
  }

  const data = state.data;
  const feed = sectionFeedStatus({
    loading: state.status === "loading",
    hasData: Boolean(data?.groups.length || data?.plugs.length),
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
    <section className="animate-fade-up" aria-labelledby="smarthome-heading">
      <div className="flex items-end justify-between gap-3">
        <h2 id="smarthome-heading" className="section-label">
          Smarthome
        </h2>
        <SectionMeta
          status={feed}
          fetchedAt={data?.fetchedAt}
          nowMs={nowMs}
        />
      </div>

      {data?.groups.length ? (
        <div className="mt-6 flex flex-col gap-8">
          {data.groups.map((group) => (
            <GroupBlock
              key={group.id}
              group={group}
              onGroupAction={postGroup}
              onCoverAction={postCover}
              groupMotionOverride={groupMotionOverrides[group.id]}
              coverMotionOverrides={coverMotionOverrides}
              actionErrors={actionErrors}
            />
          ))}
        </div>
      ) : state.status === "loading" ? (
        <p className="mt-5 text-sm text-muted">Laden…</p>
      ) : (
        <p className="mt-5 text-sm text-muted">
          Keine Rollläden konfiguriert.
        </p>
      )}

      {data?.plugs.length ? (
        <>
          <hr className="section-divider mt-8" />
          <section className="mt-6" aria-labelledby="smarthome-plugs-heading">
            <h3
              id="smarthome-plugs-heading"
              className="text-base font-semibold tracking-tight"
            >
              Steckdosen
            </h3>
            <ul className="mt-4 flex flex-col gap-4">
              {data.plugs.map((plug) => (
                <PlugRow
                  key={plug.id}
                  plug={plug}
                  busy={plugBusyId === plug.id}
                  error={actionErrors[`plug:${plug.id}`]}
                  onToggle={(on) => void postPlug(plug.id, on)}
                />
              ))}
            </ul>
          </section>
        </>
      ) : null}

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
