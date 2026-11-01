"use client";

import {
  createContext,
  useContext,
  useLayoutEffect,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import {
  THEME_STORAGE_KEY,
  isThemePreference,
  resolveTheme,
  type ResolvedTheme,
  type ThemePreference,
} from "@/lib/theme";

type ThemeContextValue = {
  preference: ThemePreference;
  resolved: ResolvedTheme;
  setPreference: (preference: ThemePreference) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

function applyResolved(resolved: ResolvedTheme) {
  document.documentElement.dataset.theme = resolved;
}

function readPreference(): ThemePreference {
  const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
  return isThemePreference(stored) ? stored : "auto";
}

function subscribePreference(onStoreChange: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.key === THEME_STORAGE_KEY || event.key === null) onStoreChange();
  };
  window.addEventListener("storage", onStorage);
  window.addEventListener("rrs37-theme", onStoreChange);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener("rrs37-theme", onStoreChange);
  };
}

function subscribeSystem(onStoreChange: () => void) {
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  media.addEventListener("change", onStoreChange);
  return () => media.removeEventListener("change", onStoreChange);
}

function getSystemDarkSnapshot() {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function getServerPreference(): ThemePreference {
  return "auto";
}

function getServerSystemDark() {
  return false;
}

function setPreference(next: ThemePreference) {
  window.localStorage.setItem(THEME_STORAGE_KEY, next);
  window.dispatchEvent(new Event("rrs37-theme"));
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const preference = useSyncExternalStore(
    subscribePreference,
    readPreference,
    getServerPreference,
  );
  const systemDark = useSyncExternalStore(
    subscribeSystem,
    getSystemDarkSnapshot,
    getServerSystemDark,
  );

  const resolved = resolveTheme(preference, systemDark);

  useLayoutEffect(() => {
    applyResolved(resolved);
  }, [resolved]);

  return (
    <ThemeContext.Provider value={{ preference, resolved, setPreference }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}

/** Inline before paint to avoid theme flash. */
export const themeBootScript = `(function(){try{var k=${JSON.stringify(THEME_STORAGE_KEY)};var p=localStorage.getItem(k);if(p!=="light"&&p!=="dark"&&p!=="auto")p="auto";var dark=window.matchMedia("(prefers-color-scheme: dark)").matches;var r=p==="light"?"light":p==="dark"?"dark":dark?"dark":"light";document.documentElement.dataset.theme=r;}catch(e){document.documentElement.dataset.theme="light";}})();`;
