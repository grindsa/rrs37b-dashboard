const BUILD_TIME = process.env.NEXT_PUBLIC_BUILD_TIME?.trim() || "dev";

/** Fixed lower-right build stamp (set at image/build time). */
export function BuildVersion() {
  return (
    <p
      className="pointer-events-none fixed bottom-2 right-3 z-10 text-[0.65rem] tabular-nums tracking-wide text-muted/70"
      title="Build version"
    >
      {BUILD_TIME}
    </p>
  );
}
