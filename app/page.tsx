export default function Home() {
  return (
    <div className="flex flex-1 flex-col bg-background text-foreground">
      <main className="mx-auto flex w-full max-w-lg flex-1 flex-col gap-8 px-5 py-10">
        <header className="flex flex-col gap-2">
          <p className="text-4xl font-semibold tracking-tight text-accent">
            RRS37
          </p>
          <p className="text-sm text-muted">
            Romain-Rolland-Straße 37B · Phase 1 scaffold
          </p>
        </header>

        <section className="flex flex-col gap-2 text-sm leading-relaxed text-muted">
          <p>Next.js + Tailwind + Docker are in place.</p>
          <p>
            Phase 2 adds the mobile-first UI (sensors, weather, BVG) with theme
            Auto / Light / Dark.
          </p>
        </section>
      </main>
    </div>
  );
}
