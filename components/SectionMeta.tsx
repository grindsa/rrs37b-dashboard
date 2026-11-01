"use client";

import { formatRelativeAge } from "@/lib/format";

export type SectionFeedStatus = "loading" | "live" | "stale" | "offline";

const STATUS_LABEL: Record<SectionFeedStatus, string> = {
  loading: "Laden…",
  live: "Live",
  stale: "Veraltet",
  offline: "Offline",
};

export function sectionFeedStatus(opts: {
  loading: boolean;
  hasData: boolean;
  error: boolean;
}): SectionFeedStatus {
  if (opts.loading && !opts.hasData) return "loading";
  if (opts.error && !opts.hasData) return "offline";
  if (opts.error && opts.hasData) return "stale";
  if (opts.loading) return "live";
  return opts.hasData ? "live" : "loading";
}

export function SectionMeta({
  status,
  fetchedAt,
  nowMs,
}: {
  status: SectionFeedStatus;
  fetchedAt?: string | null;
  nowMs?: number | null;
}) {
  const age =
    status !== "loading" && fetchedAt
      ? formatRelativeAge(fetchedAt, nowMs ?? null)
      : null;

  const tone =
    status === "offline"
      ? "text-danger"
      : status === "stale"
        ? "text-warning"
        : "text-muted";

  return (
    <p className={`text-xs tabular-nums ${tone}`}>
      <span>{STATUS_LABEL[status]}</span>
      {age ? <span className="text-muted"> · {age}</span> : null}
    </p>
  );
}
