"use client";

import { useTheme } from "./theme-provider";
import type { ThemePreference } from "@/lib/theme";

const OPTIONS: { value: ThemePreference; label: string }[] = [
  { value: "auto", label: "Auto" },
  { value: "light", label: "Hell" },
  { value: "dark", label: "Dunkel" },
];

export function ThemeToggle() {
  const { preference, setPreference } = useTheme();

  return (
    <div
      role="group"
      aria-label="Farbschema"
      className="inline-flex items-center gap-0.5 rounded-lg bg-surface p-0.5 text-xs font-medium"
    >
      {OPTIONS.map((option) => {
        const active = preference === option.value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            onClick={() => setPreference(option.value)}
            className={[
              "rounded-md px-2.5 py-1.5 transition-colors duration-200",
              active
                ? "bg-accent text-on-accent"
                : "text-muted hover:text-foreground",
            ].join(" ")}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
