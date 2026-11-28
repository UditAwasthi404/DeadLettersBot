import { Monitor, Moon, Sun } from "lucide-react";
import type * as React from "react";
import { type ThemeMode, useThemeMode } from "../theme.tsx";

const OPTIONS: Array<{
  value: ThemeMode;
  label: string;
  Icon: React.ComponentType<{ size?: number | string; className?: string }>;
}> = [
  { value: "light", label: "Light", Icon: Sun },
  { value: "system", label: "System", Icon: Monitor },
  { value: "dark", label: "Dark", Icon: Moon },
];

export function ThemeToggle({ withLabel = false }: { withLabel?: boolean }) {
  const { mode, setMode } = useThemeMode();

  return (
    <div className={`theme-toggle${withLabel ? " theme-toggle--labelled" : ""}`}>
      {withLabel && <span className="theme-toggle-label">Theme</span>}
      <div className="theme-toggle-track">
        {OPTIONS.map(({ value, label, Icon }) => {
          const active = mode === value;
          return (
            <button
              key={value}
              type="button"
              aria-pressed={active}
              aria-label={`${label} theme`}
              title={`${label} theme`}
              className={`theme-toggle-option${active ? " is-active" : ""}`}
              onClick={() => setMode(value)}
            >
              <Icon size={14} className="theme-toggle-glyph" />
              {withLabel && <span>{label}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}
