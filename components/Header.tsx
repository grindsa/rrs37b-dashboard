import { ThemeToggle } from "./ThemeToggle";

export function Header() {
  return (
    <header className="animate-fade-up flex items-start justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-[2.85rem] font-semibold leading-none tracking-tight text-accent sm:text-5xl">
          RRS37
        </h1>
        <p className="mt-2.5 text-sm text-muted">Romain-Rolland-Straße 37B</p>
      </div>
      <ThemeToggle />
    </header>
  );
}
