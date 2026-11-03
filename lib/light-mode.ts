/**
 * Shared light cycle helpers (server + client). Pure — no device I/O.
 * Cycle: off → on → dim → off. Mixed / unknown → on.
 */

export type LightMode = "off" | "on" | "dim";
export type LightGroupMode = LightMode | "mixed";
export type LightModeOrUnknown = LightMode | "unknown";

/** Classify a lamp from power + brightness vs configured on/dim targets. */
export function classifyLightMode(
  on: boolean | null,
  brightnessPct: number | null,
  onPercent: number,
  dimPercent?: number,
): LightModeOrUnknown {
  if (on === false) return "off";
  if (on !== true || brightnessPct === null || !Number.isFinite(brightnessPct)) {
    return "unknown";
  }
  if (dimPercent === undefined) {
    // No dim target — any powered state counts as "on".
    return "on";
  }
  const dOn = Math.abs(brightnessPct - onPercent);
  const dDim = Math.abs(brightnessPct - dimPercent);
  // Closer wins; ties prefer "on" so the next cycle step is dim.
  return dOn <= dDim ? "on" : "dim";
}

/**
 * @param hasDim — for a single lamp without `dim_percent`, skip dim (on → off).
 *   Group cycles always pass true so the group can enter dim; lamps without
 *   dim_percent are turned off when applying that mode.
 */
export function nextLightMode(
  current: LightModeOrUnknown | LightGroupMode,
  hasDim = true,
): LightMode {
  if (current === "mixed" || current === "unknown") return "on";
  if (current === "off") return "on";
  if (current === "on") return hasDim ? "dim" : "off";
  return "off";
}

/** Aggregate lamp modes for a group summary / group cycle start state. */
export function summarizeLightModes(
  modes: LightModeOrUnknown[],
): LightGroupMode | "unknown" {
  const known = modes.filter((m): m is LightMode => m !== "unknown");
  if (known.length === 0) return "unknown";
  const first = known[0];
  if (known.every((m) => m === first) && known.length === modes.length) {
    return first;
  }
  if (known.every((m) => m === first)) {
    // Some unknown — treat as mixed so cycle goes to on.
    return "mixed";
  }
  return "mixed";
}

/**
 * Group summary that treats “dim phase” as one mode: lamps with a dim target
 * at dim, plus lamps without dim_percent that are off (dim → off for them).
 * Otherwise that pattern looks “mixed” and the next cycle wrongly jumps to on.
 */
export function summarizeLightGroupModes(
  lamps: {
    mode: LightModeOrUnknown;
    /** null/undefined = no dim_percent in config. */
    dimPercent?: number | null;
  }[],
): LightGroupMode | "unknown" {
  if (lamps.length === 0) return "unknown";

  const inDimPhase = lamps.every((lamp) => {
    if (lamp.mode === "unknown") return false;
    if (lamp.mode === "dim") return true;
    if (lamp.mode === "off" && (lamp.dimPercent == null || lamp.dimPercent === undefined)) {
      return true;
    }
    return false;
  });
  const anyDim = lamps.some((lamp) => lamp.mode === "dim");
  if (inDimPhase && anyDim) return "dim";

  return summarizeLightModes(lamps.map((lamp) => lamp.mode));
}

export function lightModeStatusLabel(
  mode: LightModeOrUnknown,
  brightnessPct: number | null,
): string {
  switch (mode) {
    case "off":
      return "aus";
    case "on":
      return brightnessPct !== null ? `an · ${brightnessPct}%` : "an";
    case "dim":
      return brightnessPct !== null ? `dim · ${brightnessPct}%` : "dim";
    default:
      return "Status unbekannt";
  }
}

export function lightGroupSummaryLabel(
  lampCount: number,
  mode: LightGroupMode | "unknown",
): string {
  const count = lampCount === 1 ? "1 Lampe" : `${lampCount} Lampen`;
  switch (mode) {
    case "off":
      return `${count} · alle aus`;
    case "on":
      return `${count} · alle an`;
    case "dim":
      return `${count} · alle dim`;
    case "mixed":
      return `${count} · gemischt`;
    default:
      return count;
  }
}

/**
 * Target brightness for a cycle step.
 * `dim` with no dimPercent means off (null) — used when the lamp omits dim_percent.
 */
export function targetBrightnessPercent(
  mode: LightMode,
  onPercent: number,
  dimPercent?: number,
): number | null {
  if (mode === "off") return null;
  if (mode === "on") return onPercent;
  if (dimPercent === undefined) return null;
  return dimPercent;
}
