const berlinTime = new Intl.DateTimeFormat("de-DE", {
  timeZone: "Europe/Berlin",
  hour: "2-digit",
  minute: "2-digit",
});

export function formatTemp(celsius: number | null): string {
  if (celsius === null || Number.isNaN(celsius)) return "—";
  return `${celsius.toFixed(1).replace(".", ",")}°`;
}

export function formatHumidity(pct: number | null): string {
  if (pct === null || Number.isNaN(pct)) return "—";
  return `${Math.round(pct)} %`;
}

export function formatBattery(pct: number | null): string {
  if (pct === null || Number.isNaN(pct)) return "—";
  return `${Math.round(pct)} %`;
}

export function formatHourLabel(iso: string): string {
  return berlinTime.format(new Date(iso));
}

/**
 * Relative age in German ("gerade eben", "vor 3 Min", "vor 2 Std").
 * Pass `nowMs` from the client after mount — avoid Date.now() during prerender.
 */
export function formatRelativeAge(
  iso: string | null | undefined,
  nowMs: number | null,
): string | null {
  if (!iso || nowMs === null) return null;
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return null;
  const diffSec = Math.max(0, Math.round((nowMs - then) / 1000));
  if (diffSec < 45) return "gerade eben";
  const mins = Math.round(diffSec / 60);
  if (mins < 60) return `vor ${mins} Min`;
  const hours = Math.round(mins / 60);
  if (hours < 36) return `vor ${hours} Std`;
  const days = Math.round(hours / 24);
  return `vor ${days} T`;
}

export function formatPrecipitation(mm: number): string {
  if (mm <= 0) return "0";
  return mm.toFixed(1).replace(".", ",");
}

/**
 * Minutes until departure.
 * Pass `nowMs` from the client after mount — avoid Date.now() during prerender.
 */
export function minutesUntil(
  whenIso: string | null,
  nowMs: number | null,
): number | null {
  if (!whenIso || nowMs === null) return null;
  const diffMs = new Date(whenIso).getTime() - nowMs;
  return Math.max(0, Math.round(diffMs / 60_000));
}

export function formatDelay(delaySeconds: number | null, cancelled: boolean): {
  label: string;
  tone: "ok" | "late" | "early" | "cancelled";
} {
  if (cancelled) return { label: "fällt aus", tone: "cancelled" };
  if (delaySeconds === null) return { label: "", tone: "ok" };
  if (delaySeconds === 0) return { label: "pünktlich", tone: "ok" };
  const minutes = Math.round(Math.abs(delaySeconds) / 60);
  if (delaySeconds > 0) {
    return { label: `+${minutes} Min`, tone: "late" };
  }
  return { label: `−${minutes} Min`, tone: "early" };
}

/** Short WMO weather-code label (de). */
export function weatherLabel(code: number): string {
  if (code === 0) return "Klar";
  if (code === 1) return "Überwiegend klar";
  if (code === 2) return "Teilweise bewölkt";
  if (code === 3) return "Bedeckt";
  if (code === 45 || code === 48) return "Nebel";
  if (code >= 51 && code <= 57) return "Nieselregen";
  if (code >= 61 && code <= 67) return "Regen";
  if (code >= 71 && code <= 77) return "Schnee";
  if (code >= 80 && code <= 82) return "Regenschauer";
  if (code >= 85 && code <= 86) return "Schneeschauer";
  if (code >= 95) return "Gewitter";
  return "Wechselhaft";
}
