import { Theme } from "@radix-ui/themes";
import * as React from "react";

export type ThemeMode = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

const STORAGE_KEY = "agentos:theme";
const QUERY = "(prefers-color-scheme: dark)";

function readStoredMode(): ThemeMode {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === "light" || stored === "dark" || stored === "system") return stored;
  } catch {
    // Storage can be blocked; fall through to the default.
  }
  return "dark";
}

function prefersDark(): boolean {
  return typeof window.matchMedia === "function" ? window.matchMedia(QUERY).matches : true;
}

function resolve(mode: ThemeMode, systemDark: boolean): ResolvedTheme {
  if (mode === "system") return systemDark ? "dark" : "light";
  return mode;
}

// Resolve and paint the theme as soon as this module loads so the app never
// flashes the wrong palette on startup.
const initialMode = readStoredMode();
const initialResolved = resolve(initialMode, prefersDark());
document.documentElement.dataset.theme = initialResolved;
document.documentElement.style.colorScheme = initialResolved;

type ThemeContextValue = {
  mode: ThemeMode;
  resolved: ResolvedTheme;
  setMode: (mode: ThemeMode) => void;
  cycle: () => void;
};

const ThemeModeContext = React.createContext<ThemeContextValue | null>(null);

export function ThemeController({ children }: { children: React.ReactNode }) {
  const [mode, setModeState] = React.useState<ThemeMode>(initialMode);
  const [systemDark, setSystemDark] = React.useState<boolean>(prefersDark);
  const resolved = resolve(mode, systemDark);

  React.useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const media = window.matchMedia(QUERY);
    const onChange = (event: MediaQueryListEvent) => setSystemDark(event.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  React.useEffect(() => {
    document.documentElement.dataset.theme = resolved;
    document.documentElement.style.colorScheme = resolved;
    window.agentOS?.setNativeTheme?.(resolved);
  }, [resolved]);

  React.useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, mode);
    } catch {
      // Persisting the preference is best-effort.
    }
  }, [mode]);

  const value = React.useMemo<ThemeContextValue>(
    () => ({
      mode,
      resolved,
      setMode: setModeState,
      cycle: () =>
        setModeState((current) => {
          if (current === "dark") return "light";
          if (current === "light") return "system";
          return "dark";
        }),
    }),
    [mode, resolved],
  );

  return (
    <ThemeModeContext.Provider value={value}>
      <Theme appearance={resolved} accentColor="teal" grayColor="sand" radius="medium">
        {children}
      </Theme>
    </ThemeModeContext.Provider>
  );
}

export function useThemeMode(): ThemeContextValue {
  const value = React.useContext(ThemeModeContext);
  if (!value) throw new Error("useThemeMode must be used inside ThemeController");
  return value;
}
