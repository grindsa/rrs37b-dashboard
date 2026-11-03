import type { AuthStatus } from "@/lib/auth";
import { AuthLock } from "./AuthLock";
import { ThemeToggle } from "./ThemeToggle";

export function Header({
  initialAuth = "anonymous",
}: {
  initialAuth?: AuthStatus;
}) {
  // The address is only rendered for unlocked sessions.
  const showAddress = initialAuth === "authenticated";
  return (
    <header className="animate-fade-up flex items-start justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-[2.85rem] font-semibold leading-none tracking-tight text-accent sm:text-5xl">
          RRS37
        </h1>
        {showAddress ? (
          <p className="mt-2.5 text-sm text-muted">Romain-Rolland-Straße 37B</p>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-1.5 pt-1 sm:gap-2">
        <ThemeToggle />
        <AuthLock initialStatus={initialAuth} />
      </div>
    </header>
  );
}
