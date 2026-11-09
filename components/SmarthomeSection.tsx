"use client";

import { useEffect, useRef, useState } from "react";
import type {
  CoverAction,
  CoverDeviceStatus,
  LampDeviceStatus,
  PlugDeviceStatus,
  SmarthomeGroupStatus,
  SmarthomeLightGroupStatus,
  SmarthomeSnapshot,
} from "@/lib/smarthome";
import {
  lightGroupSummaryLabel,
  lightModeStatusLabel,
  nextLightMode,
  summarizeLightGroupModes,
  type LightGroupMode,
  type LightMode,
  type LightModeOrUnknown,
} from "@/lib/light-mode";
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
/** Gira BLE commands can take much longer than Shelly RPC. */
const OVERRIDE_GIVE_UP_GIRA_MS = 90_000;
const OVERRIDE_MAX_MS = 180_000;

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
    // Gira covers often stay "idle" in ads until the GATT write finishes.
    const giveUpMs = covers.some((c) => c.vendor === "gira")
      ? OVERRIDE_GIVE_UP_GIRA_MS
      : OVERRIDE_GIVE_UP_MS;
    if (age > giveUpMs) {
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
  const unpaired = cover.vendor === "gira" && cover.paired === false;
  const controlsDisabled =
    unpaired || (!cover.online && cover.state === "unknown");
  const pairedHint =
    cover.vendor === "gira"
      ? cover.paired === true
        ? "gekoppelt"
        : "nicht gekoppelt"
      : null;

  return (
    <li className="border-t border-hairline pt-3 first:border-t-0 first:pt-0">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <p className="text-sm font-medium text-foreground">{cover.name}</p>
            {pairedHint ? (
              <span
                className={
                  cover.paired === true ? "text-muted" : "text-muted/35"
                }
                title={pairedHint}
                aria-label={pairedHint}
              >
                <BluetoothIcon className="h-3.5 w-3.5" />
              </span>
            ) : null}
          </div>
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
  const standalone = group.standalone;
  const solo = group.covers[0];
  const statusLine = standalone
    ? solo
      ? coverStatusLabel(solo)
      : null
    : `${coverCount === 1 ? "1 Rollo" : `${coverCount} Rollos`}${
        expanded ? "" : " · antippen für Details"
      }`;
  const statusWarning = standalone
    ? Boolean(solo && !solo.online)
    : false;
  const groupError =
    actionErrors[`group:${group.id}`] ??
    (standalone && solo
      ? actionErrors[`cover:${solo.id}`]
      : undefined);

  return (
    <section aria-labelledby={`smarthome-group-${group.id}`}>
      <div className="flex items-center justify-between gap-3">
        {standalone ? (
          <div className="flex min-w-0 flex-1 items-center gap-2">
            {/* Match expandable group chevron gutter so names align. */}
            <span className="invisible text-xs" aria-hidden>
              ▸
            </span>
            <span className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span
                  id={`smarthome-group-${group.id}`}
                  className="block text-base font-semibold tracking-tight"
                >
                  {group.name}
                </span>
                {solo?.vendor === "gira" ? (
                  <span
                    className={
                      solo.paired === true ? "text-muted" : "text-muted/35"
                    }
                    title={
                      solo.paired === true ? "gekoppelt" : "nicht gekoppelt"
                    }
                    aria-label={
                      solo.paired === true ? "gekoppelt" : "nicht gekoppelt"
                    }
                  >
                    <BluetoothIcon className="h-3.5 w-3.5" />
                  </span>
                ) : null}
              </div>
              {statusLine ? (
                <span
                  className={[
                    "mt-0.5 block text-xs",
                    statusWarning ? "text-warning" : "text-muted",
                  ].join(" ")}
                >
                  {statusLine}
                </span>
              ) : null}
            </span>
          </div>
        ) : (
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
                {statusLine}
              </span>
            </span>
          </button>
        )}
        <CoverControlPill
          motion={groupMotion}
          onAction={(action) => onGroupAction(group.id, action)}
          disabled={
            standalone &&
            solo != null &&
            (solo.paired === false ||
              (!solo.online && solo.state === "unknown"))
          }
          openLabel={
            standalone ? `${group.name} auf` : `${group.name} alle auf`
          }
          closeLabel={
            standalone ? `${group.name} zu` : `${group.name} alle zu`
          }
          stopOpenLabel={`${group.name} stoppen`}
          stopCloseLabel={`${group.name} stoppen`}
        />
      </div>
      {groupError ? (
        <p className="mt-2 text-xs text-warning">{groupError}</p>
      ) : null}

      {!standalone && expanded ? (
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

function LightCycleButton({
  mode,
  brightnessPct,
  dimPercent,
  label,
  disabled,
  onCycle,
}: {
  mode: LightModeOrUnknown | LightGroupMode;
  brightnessPct?: number | null;
  /** Shown on dim badge; falls back to brightnessPct. */
  dimPercent?: number;
  label: string;
  disabled?: boolean;
  onCycle: () => void;
}) {
  const visual: LightMode | "mixed" | "unknown" =
    mode === "mixed" || mode === "unknown" || mode === "off" || mode === "on" || mode === "dim"
      ? mode
      : "unknown";

  const filled = visual === "on";
  const soft = visual === "dim";
  const badge =
    visual === "dim"
      ? `${dimPercent ?? brightnessPct ?? "?"}%`
      : visual === "mixed"
        ? "~"
        : null;

  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        onCycle();
      }}
      className={[
        "relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-accent transition-[box-shadow,opacity,background-color] duration-200 disabled:opacity-45",
        filled
          ? "bg-accent text-background ring-2 ring-accent ring-offset-2 ring-offset-background"
          : soft
            ? "bg-accent/25 ring-1 ring-accent/50"
            : "bg-surface",
      ].join(" ")}
    >
      <IconPower className="h-5 w-5" />
      {badge ? (
        <span
          className={[
            "absolute -bottom-1 -right-1 min-w-[1.15rem] rounded-full px-1 text-[0.65rem] font-semibold leading-4",
            soft
              ? "bg-accent text-background"
              : "bg-surface text-muted ring-1 ring-hairline",
          ].join(" ")}
        >
          {badge}
        </span>
      ) : null}
    </button>
  );
}

function LampRow({
  lamp,
  busy,
  error,
  onCycle,
}: {
  lamp: LampDeviceStatus;
  busy: boolean;
  error?: string;
  onCycle: () => void;
}) {
  return (
    <li className="border-t border-hairline pt-3 first:border-t-0 first:pt-0">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground">{lamp.name}</p>
          <p
            className={[
              "mt-0.5 text-xs",
              lamp.online ? "text-muted" : "text-warning",
            ].join(" ")}
          >
            {!lamp.online
              ? lamp.error
                ? `offline · ${lamp.error}`
                : "offline"
              : lightModeStatusLabel(lamp.mode, lamp.brightnessPct)}
          </p>
          {error ? <p className="mt-1 text-xs text-warning">{error}</p> : null}
        </div>
        <LightCycleButton
          mode={lamp.mode}
          brightnessPct={lamp.brightnessPct}
          dimPercent={lamp.dimPercent ?? undefined}
          label={`${lamp.name} Modus wechseln`}
          disabled={busy || (!lamp.online && lamp.mode === "unknown")}
          onCycle={onCycle}
        />
      </div>
    </li>
  );
}

function LightGroupBlock({
  group,
  busyIds,
  actionErrors,
  onGroupCycle,
  onLampCycle,
}: {
  group: SmarthomeLightGroupStatus;
  busyIds: Set<string>;
  actionErrors: Record<string, string>;
  onGroupCycle: (groupId: string) => void;
  onLampCycle: (lampId: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const lampCount = group.lamps.length;
  const groupBusy =
    busyIds.has(`light-group:${group.id}`) ||
    group.lamps.some((l) => busyIds.has(`lamp:${l.id}`));

  return (
    <section aria-labelledby={`smarthome-light-group-${group.id}`}>
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={`smarthome-light-group-lamps-${group.id}`}
          onClick={() => setExpanded((v) => !v)}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          <span className="text-xs text-muted" aria-hidden>
            {expanded ? "▾" : "▸"}
          </span>
          <span className="min-w-0">
            <span
              id={`smarthome-light-group-${group.id}`}
              className="block text-base font-semibold tracking-tight"
            >
              {group.name}
            </span>
            <span className="mt-0.5 block text-xs text-muted">
              {lightGroupSummaryLabel(lampCount, group.mode)}
              {expanded ? "" : " · antippen für Details"}
            </span>
          </span>
        </button>
        <LightCycleButton
          mode={group.mode}
          dimPercent={
            group.mode === "dim"
              ? (() => {
                  const dims = group.lamps
                    .map((l) => l.dimPercent)
                    .filter((p): p is number => p != null);
                  if (dims.length === 0) return undefined;
                  return Math.round(
                    dims.reduce((s, p) => s + p, 0) / dims.length,
                  );
                })()
              : undefined
          }
          label={`${group.name} Modus wechseln`}
          disabled={groupBusy}
          onCycle={() => onGroupCycle(group.id)}
        />
      </div>
      {actionErrors[`light-group:${group.id}`] ? (
        <p className="mt-2 text-xs text-warning">
          {actionErrors[`light-group:${group.id}`]}
        </p>
      ) : null}

      {expanded ? (
        <ul
          id={`smarthome-light-group-lamps-${group.id}`}
          className="mt-4 flex flex-col gap-3"
        >
          {group.lamps.map((lamp) => (
            <LampRow
              key={lamp.id}
              lamp={lamp}
              busy={busyIds.has(`lamp:${lamp.id}`) || groupBusy}
              error={actionErrors[`lamp:${lamp.id}`]}
              onCycle={() => onLampCycle(lamp.id)}
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
          "flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-accent transition-[box-shadow,opacity,background-color] duration-200 disabled:opacity-45",
          checked
            ? "bg-accent text-background ring-2 ring-accent ring-offset-2 ring-offset-background"
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
  const [lightBusyIds, setLightBusyIds] = useState<Set<string>>(() => new Set());
  const [actionErrors, setActionErrors] = useState<Record<string, string>>({});
  const anyMovingRef = useRef(Boolean(initialData?.anyMoving));
  const coverOverridesRef = useRef(coverMotionOverrides);
  const groupOverridesRef = useRef(groupMotionOverrides);
  coverOverridesRef.current = coverMotionOverrides;
  groupOverridesRef.current = groupMotionOverrides;

  function patchLampMode(
    data: SmarthomeSnapshot,
    lampId: string,
    mode: LightMode,
  ): SmarthomeSnapshot {
    return {
      ...data,
      lightGroups: data.lightGroups.map((group) => {
        const lamps = group.lamps.map((lamp) => {
          if (lamp.id !== lampId) return lamp;
          const effective: LightMode =
            mode === "dim" && lamp.dimPercent == null ? "off" : mode;
          return {
            ...lamp,
            mode: effective,
            brightnessPct:
              effective === "off"
                ? 0
                : effective === "on"
                  ? lamp.onPercent
                  : (lamp.dimPercent ?? 0),
            online: true,
            error: undefined,
          };
        });
        return {
          ...group,
          lamps,
          mode: summarizeLightGroupModes(
            lamps.map((l) => ({ mode: l.mode, dimPercent: l.dimPercent })),
          ),
        };
      }),
    };
  }

  function patchLightGroupMode(
    data: SmarthomeSnapshot,
    groupId: string,
    mode: LightMode,
  ): SmarthomeSnapshot {
    return {
      ...data,
      lightGroups: data.lightGroups.map((group) => {
        if (group.id !== groupId) return group;
        const lamps = group.lamps.map((lamp) => {
          const effective: LightMode =
            mode === "dim" && lamp.dimPercent == null ? "off" : mode;
          return {
            ...lamp,
            mode: effective,
            brightnessPct:
              effective === "off"
                ? 0
                : effective === "on"
                  ? lamp.onPercent
                  : (lamp.dimPercent ?? 0),
            online: true,
            error: undefined,
          };
        });
        return {
          ...group,
          mode: summarizeLightGroupModes(
            lamps.map((l) => ({ mode: l.mode, dimPercent: l.dimPercent })),
          ),
          lamps,
        };
      }),
    };
  }

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
        const res = await fetch("/api/smarthome", {
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
          const aborted =
            err instanceof DOMException && err.name === "TimeoutError";
          setState((prev) => ({
            status: "error",
            message: aborted
              ? "Smarthome-Status Timeout — offline Lampen?"
              : err instanceof Error
                ? err.message
                : "Fehler",
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
        if (cancelled) return;
        // Pick up stale-while-revalidate / finish probing offline lamps.
        window.setTimeout(() => {
          if (!cancelled) void load();
        }, 3_000);
        scheduleNext();
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

  async function postLampCycle(lampId: string) {
    const lamp = state.data?.lightGroups
      .flatMap((g) => g.lamps)
      .find((l) => l.id === lampId);
    const next = nextLightMode(
      lamp?.mode ?? "unknown",
      lamp?.dimPercent != null,
    );

    setLightBusyIds((prev) => new Set(prev).add(`lamp:${lampId}`));
    setActionErrors((prev) => {
      const nextErr = { ...prev };
      delete nextErr[`lamp:${lampId}`];
      return nextErr;
    });
    setState((prev) =>
      prev.data
        ? { ...prev, status: "live", data: patchLampMode(prev.data, lampId, next) }
        : prev,
    );

    try {
      const res = await fetch("/api/smarthome/light", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lampId }),
      });
      const payload = (await res.json()) as {
        error?: string;
        mode?: LightMode;
        result?: { ok: boolean; error?: string };
      };
      if (!res.ok || payload.result?.ok === false) {
        setActionErrors((prev) => ({
          ...prev,
          [`lamp:${lampId}`]:
            payload.result?.error ?? payload.error ?? `HTTP ${res.status}`,
        }));
      }
      await refreshSoon();
    } catch (err) {
      setActionErrors((prev) => ({
        ...prev,
        [`lamp:${lampId}`]:
          err instanceof Error ? err.message : "Lampenbefehl fehlgeschlagen",
      }));
    } finally {
      setLightBusyIds((prev) => {
        const nextBusy = new Set(prev);
        nextBusy.delete(`lamp:${lampId}`);
        return nextBusy;
      });
    }
  }

  async function postLightGroupCycle(groupId: string) {
    const group = state.data?.lightGroups.find((g) => g.id === groupId);
    const next = nextLightMode(group?.mode ?? "unknown");

    setLightBusyIds((prev) => new Set(prev).add(`light-group:${groupId}`));
    setActionErrors((prev) => {
      const nextErr = { ...prev };
      delete nextErr[`light-group:${groupId}`];
      return nextErr;
    });
    setState((prev) =>
      prev.data
        ? {
            ...prev,
            status: "live",
            data: patchLightGroupMode(prev.data, groupId, next),
          }
        : prev,
    );

    try {
      const res = await fetch("/api/smarthome/light-group", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ groupId }),
      });
      const payload = (await res.json()) as {
        error?: string;
        results?: { id: string; ok: boolean; error?: string }[];
      };
      if (!res.ok && res.status !== 207) {
        setActionErrors((prev) => ({
          ...prev,
          [`light-group:${groupId}`]: payload.error ?? `HTTP ${res.status}`,
        }));
      } else if (payload.results?.some((r) => !r.ok)) {
        const failed = payload.results
          .filter((r) => !r.ok)
          .map((r) => r.error ?? r.id)
          .join("; ");
        setActionErrors((prev) => ({
          ...prev,
          [`light-group:${groupId}`]: failed || "Teilfehler",
        }));
      }
      await refreshSoon();
    } catch (err) {
      setActionErrors((prev) => ({
        ...prev,
        [`light-group:${groupId}`]:
          err instanceof Error
            ? err.message
            : "Lampen-Gruppenbefehl fehlgeschlagen",
      }));
    } finally {
      setLightBusyIds((prev) => {
        const nextBusy = new Set(prev);
        nextBusy.delete(`light-group:${groupId}`);
        return nextBusy;
      });
    }
  }

  const data = state.data;
  const feed = sectionFeedStatus({
    loading: state.status === "loading",
    hasData: Boolean(
      data?.groups.length || data?.lightGroups.length || data?.plugs.length,
    ),
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
      ) : data?.lightGroups.length || data?.plugs.length ? null : (
        <p className="mt-5 text-sm text-muted">
          Keine Rollläden konfiguriert.
        </p>
      )}

      {data?.lightGroups.length ? (
        <>
          <hr className="section-divider mt-8" />
          <section className="mt-6" aria-labelledby="smarthome-lights-heading">
            <h3
              id="smarthome-lights-heading"
              className="text-base font-semibold tracking-tight"
            >
              Lampen
            </h3>
            <div className="mt-4 flex flex-col gap-8">
              {data.lightGroups.map((group) => (
                <LightGroupBlock
                  key={group.id}
                  group={group}
                  busyIds={lightBusyIds}
                  actionErrors={actionErrors}
                  onGroupCycle={(id) => void postLightGroupCycle(id)}
                  onLampCycle={(id) => void postLampCycle(id)}
                />
              ))}
            </div>
          </section>
        </>
      ) : null}

      {data?.plugs.length ? (
        <>
          <hr className="section-divider mt-8" />
          <section className="mt-6" aria-labelledby="smarthome-plugs-heading">
            <h3
              id="smarthome-plugs-heading"
              className="text-base font-semibold tracking-tight"
            >
              Smarthomegeräte
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
