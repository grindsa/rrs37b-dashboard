"use client";

import {
  createContext,
  useContext,
  useEffect,
  useId,
  useState,
  type ReactNode,
} from "react";

export type DashboardTabId = "home" | "bvg" | "pv" | "smarthome";

const TABS: { id: DashboardTabId; label: string }[] = [
  { id: "home", label: "Sensoren & Wetter" },
  { id: "bvg", label: "BVG" },
  { id: "smarthome", label: "Smarthome" },
  { id: "pv", label: "PV" },
];

const ActiveTabContext = createContext<DashboardTabId>("home");
const TabBaseIdContext = createContext("");

/**
 * Tab chrome renders immediately. Panel bodies are `children`
 * (`DashboardTabPanel`) so Suspense inside them can stream without
 * blocking sibling tabs or the shell (avoid Server Components as props).
 */
export function DashboardTabs({ children }: { children: ReactNode }) {
  const baseId = useId();
  const [active, setActive] = useState<DashboardTabId>("home");

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
                  "flex-1 rounded-md px-1.5 py-2 transition-colors duration-200 sm:px-3",
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

      <ActiveTabContext.Provider value={active}>
        <TabBaseIdContext.Provider value={baseId}>
          {children}
        </TabBaseIdContext.Provider>
      </ActiveTabContext.Provider>
    </div>
  );
}

export function DashboardTabPanel({
  id,
  children,
}: {
  id: DashboardTabId;
  children: ReactNode;
}) {
  const active = useContext(ActiveTabContext);
  const baseId = useContext(TabBaseIdContext);
  const selected = active === id;
  // Mount on first visit only — avoids probing Tuya/Shelly while another tab is open.
  const [mounted, setMounted] = useState(selected);
  useEffect(() => {
    if (selected) setMounted(true);
  }, [selected]);

  return (
    <div
      role="tabpanel"
      id={`${baseId}-panel-${id}`}
      aria-labelledby={`${baseId}-tab-${id}`}
      hidden={!selected}
      className={selected ? "animate-fade-up" : undefined}
    >
      {mounted ? children : null}
    </div>
  );
}
