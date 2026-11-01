export function LockedPanel() {
  return (
    <section
      className="animate-fade-up rounded-xl border border-hairline bg-surface/60 px-5 py-10 text-center"
      aria-live="polite"
    >
      <p className="text-sm font-medium text-muted">Geschützt</p>
      <p className="mt-2 text-base text-foreground">
        Tippe auf das Schloss oben rechts und gib den Zugangscode ein.
      </p>
    </section>
  );
}
