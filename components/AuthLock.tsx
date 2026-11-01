"use client";

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { useRouter } from "next/navigation";
import type { AuthStatus } from "@/lib/auth";

function LockOpenIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 7.5-1.9" />
    </svg>
  );
}

function LockClosedIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </svg>
  );
}

function LockInvalidBadge() {
  return (
    <span
      className="pointer-events-none absolute -right-0.5 -top-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-danger text-[0.55rem] font-bold leading-none text-white"
      aria-hidden
    >
      !
    </span>
  );
}

export function AuthLock({ initialStatus }: { initialStatus: AuthStatus }) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const [status, setStatus] = useState<AuthStatus>(initialStatus);
  const [token, setToken] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/auth/status", { cache: "no-store" });
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as { status?: AuthStatus };
        if (
          data.status === "authenticated" ||
          data.status === "anonymous" ||
          data.status === "invalid"
        ) {
          // Server clears a bad cookie and reports anonymous; keep local
          // "invalid" only after a failed unlock attempt in this session.
          if (data.status !== "invalid") setStatus(data.status);
        }
      } catch {
        /* keep initial */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const openDialog = useCallback(() => {
    setError(null);
    setToken("");
    dialogRef.current?.showModal();
    queueMicrotask(() => inputRef.current?.focus());
  }, []);

  const closeDialog = useCallback(() => {
    dialogRef.current?.close();
    setToken("");
    setError(null);
  }, []);

  const logout = useCallback(async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {
      /* still clear local state */
    }
    setStatus("anonymous");
    router.refresh();
  }, [router]);

  const onLockClick = useCallback(() => {
    if (status === "authenticated") {
      void logout();
      return;
    }
    openDialog();
  }, [logout, openDialog, status]);

  const onSubmit = useCallback(
    async (event: FormEvent) => {
      event.preventDefault();
      setSubmitting(true);
      setError(null);
      try {
        const res = await fetch("/api/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token }),
        });
        if (!res.ok) {
          setStatus("invalid");
          setError("Ungültiger Zugangscode.");
          return;
        }
        setStatus("authenticated");
        closeDialog();
        router.refresh();
      } catch {
        setStatus("invalid");
        setError("Anmeldung fehlgeschlagen.");
      } finally {
        setSubmitting(false);
      }
    },
    [closeDialog, router, token],
  );

  const label =
    status === "authenticated"
      ? "Sitzung beenden"
      : status === "invalid"
        ? "Zugangscode ungültig — erneut eingeben"
        : "Zugangscode eingeben";

  return (
    <>
      <button
        type="button"
        onClick={onLockClick}
        aria-label={label}
        title={label}
        className="relative inline-flex h-9 w-9 items-center justify-center rounded-lg text-muted transition-colors hover:bg-surface hover:text-foreground"
      >
        {status === "authenticated" ? (
          <LockClosedIcon className="h-5 w-5" />
        ) : (
          <LockOpenIcon className="h-5 w-5" />
        )}
        {status === "invalid" ? <LockInvalidBadge /> : null}
      </button>

      <dialog
        ref={dialogRef}
        aria-labelledby={titleId}
        className="m-auto w-[min(100%,22rem)] rounded-xl border border-hairline bg-background p-0 text-foreground shadow-lg backdrop:bg-foreground/35"
        onClose={() => {
          setToken("");
          setError(null);
        }}
        onClick={(e) => {
          if (e.target === dialogRef.current) closeDialog();
        }}
      >
        <form onSubmit={onSubmit} className="flex flex-col gap-4 p-5">
          <div>
            <h2 id={titleId} className="text-base font-semibold tracking-tight">
              Zugangscode
            </h2>
            <p className="mt-1 text-sm text-muted">
              Gemeinsamen Token eingeben — kein Passwort-Konto.
            </p>
          </div>

          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium text-muted">Token</span>
            <input
              ref={inputRef}
              type="password"
              name="token"
              autoComplete="current-password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              className="rounded-lg border border-hairline bg-surface px-3 py-2 text-foreground outline-none ring-accent focus:ring-2"
              required
            />
          </label>

          {error ? (
            <p className="text-sm text-danger" role="alert">
              {error}
            </p>
          ) : null}

          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={closeDialog}
              className="rounded-md px-3 py-2 text-sm text-muted transition-colors hover:text-foreground"
            >
              Abbrechen
            </button>
            <button
              type="submit"
              disabled={submitting || !token.trim()}
              className="rounded-md bg-accent px-3 py-2 text-sm font-medium text-on-accent transition-opacity disabled:opacity-50"
            >
              {submitting ? "Prüfen…" : "Entsperren"}
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}
