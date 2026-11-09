"use client";

import {
  createContext,
  useContext,
  useEffect,
  useId,
  useState,
  type ReactNode,
} from "react";

export type DashboardTabId = "home" | "bvg" | "heating" | "pv" | "smarthome";

type TabIcon = "home" | "bvg" | "heating" | "smarthome" | "pv";

type TabDef =
  | { id: DashboardTabId; label: string; icon?: undefined }
  | { id: DashboardTabId; label: string; icon: TabIcon };

const TABS: TabDef[] = [
  { id: "home", label: "Sensoren & Wetter", icon: "home" },
  { id: "bvg", label: "BVG", icon: "bvg" },
  { id: "smarthome", label: "Smarthome", icon: "smarthome" },
  { id: "heating", label: "Heizung", icon: "heating" },
  { id: "pv", label: "PV", icon: "pv" },
];

/** Thermometer + sun rays for sensors & weather. */
function ClimateTabIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d="M9 4v10.5a3.5 3.5 0 1 0 3 0V4a1.5 1.5 0 0 0-3 0z" />
      <path d="M10.5 13.5v2" />
      <circle cx="17.5" cy="7.5" r="2" />
      <path d="M17.5 3.5v1" />
      <path d="M21 7.5h-1" />
      <path d="M20 4.8l-.7.7" />
      <path d="M20 10.2l-.7-.7" />
    </svg>
  );
}

/** Side-view bus for the BVG tab. */
function BusTabIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d="M3 15V8.5A2.5 2.5 0 0 1 5.5 6h11A4.5 4.5 0 0 1 21 10.5V15" />
      <path d="M3 15h18" />
      <path d="M3 11h18" />
      <path d="M6.5 8h2.5" />
      <path d="M11 8h2.5" />
      <path d="M15.5 8H18" />
      <circle cx="7" cy="15" r="1.75" />
      <circle cx="17" cy="15" r="1.75" />
      <path d="M21 12.5v-1" />
    </svg>
  );
}

/** Simplified radiator panel for the Heizung tab. */
function HeatingTabIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <rect x="5" y="5" width="14" height="12" rx="2" />
      <path d="M9 8v6" />
      <path d="M12 8v6" />
      <path d="M15 8v6" />
      <path d="M8 20v-1" />
      <path d="M16 20v-1" />
    </svg>
  );
}

/** House + bolt for the Smarthome tab. */
function SmarthomeTabIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d="M4 11.5L12 4l8 7.5" />
      <path d="M6.5 10.5V20h11V10.5" />
      <path d="M13 11.5h-2.5l1.6-3.5H10L8.2 15.5h2.4L9.5 20 14.5 13H12z" />
    </svg>
  );
}

/** Tilted solar panel grid for the PV tab. */
function SolarTabIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d="M4 16l3-10h10l3 10H4z" />
      <path d="M7 6v10" />
      <path d="M12 6v10" />
      <path d="M17 6v10" />
      <path d="M5.5 11h13" />
      <path d="M10 18v2" />
      <path d="M14 18v2" />
      <path d="M8 20h8" />
    </svg>
  );
}

function TabIconMark({ icon }: { icon: TabIcon }) {
  if (icon === "home") return <ClimateTabIcon className="h-5 w-5" />;
  if (icon === "bvg") return <BusTabIcon className="h-5 w-5" />;
  if (icon === "heating") return <HeatingTabIcon className="h-5 w-5" />;
  if (icon === "smarthome") return <SmarthomeTabIcon className="h-5 w-5" />;
  return <SolarTabIcon className="h-5 w-5" />;
}

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
    <div className="flex flex-col gap-4">
      <div
        role="tablist"
        aria-label="Bereich"
        className="sticky top-0 z-20 -mx-5 flex items-center gap-0.5 bg-background/85 px-5 py-1.5 backdrop-blur-md sm:-mx-6 sm:px-6"
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
                aria-label={tab.icon ? tab.label : undefined}
                title={tab.icon ? tab.label : undefined}
                aria-selected={selected}
                aria-controls={`${baseId}-panel-${tab.id}`}
                tabIndex={selected ? 0 : -1}
                onClick={() => setActive(tab.id)}
                className={[
                  "flex flex-1 items-center justify-center rounded-md px-1.5 py-2 transition-colors duration-200 sm:px-3",
                  selected
                    ? "bg-accent text-on-accent"
                    : "text-muted hover:text-foreground",
                ].join(" ")}
              >
                {tab.icon ? <TabIconMark icon={tab.icon} /> : tab.label}
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
