"use client";

import { useId, useState, type ReactNode } from "react";

export type DashboardTabId = "home" | "bvg";

const TABS: { id: DashboardTabId; label: string }[] = [
  { id: "home", label: "Sensoren & Wetter" },
  { id: "bvg", label: "BVG" },
];

export function DashboardTabs({
  home,
  bvg,
}: {
  home: ReactNode;
  bvg: ReactNode;
}) {
  const baseId = useId();
  const [active, setActive] = useState<DashboardTabId>("home");

  const panels: Record<DashboardTabId, ReactNode> = {
    home,
    bvg,
  };

  return (
    <div className="flex flex-col gap-6">
      <div
        role="tablist"
        aria-label="Bereich"
        className="sticky top-0 z-20 -mx-5 flex items-center gap-0.5 bg-background/85 px-5 py-2 backdrop-blur-md sm:-mx-6 sm:px-6"
      >
        <div className="inline-flex w-full items-center gap-0.5 rounded-lg bg-surface p-0.5 text-sm font-medium">
          {TABS.map((tab) => {
            const selected = active === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                id={`${baseId}-tab-${tab.id}`}
                aria-selected={selected}
                aria-controls={`${baseId}-panel-${tab.id}`}
                tabIndex={selected ? 0 : -1}
                onClick={() => setActive(tab.id)}
                className={[
                  "flex-1 rounded-md px-3 py-2 transition-colors duration-200",
                  selected
                    ? "bg-accent text-on-accent"
                    : "text-muted hover:text-foreground",
                ].join(" ")}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {TABS.map((tab) => {
        const selected = active === tab.id;
        return (
          <div
            key={tab.id}
            role="tabpanel"
            id={`${baseId}-panel-${tab.id}`}
            aria-labelledby={`${baseId}-tab-${tab.id}`}
            hidden={!selected}
            className={selected ? "animate-fade-up" : undefined}
          >
            {panels[tab.id]}
          </div>
        );
      })}
    </div>
  );
}
