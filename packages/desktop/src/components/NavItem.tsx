import { Button, Tooltip } from "@radix-ui/themes";
import type * as React from "react";

type NavItemProps = {
  icon: React.ReactNode;
  label: string;
  tooltip?: string;
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
};

export function NavItem({ icon, label, tooltip, active, disabled, onClick }: NavItemProps) {
  return (
    <Tooltip content={tooltip ?? label} side="right" delayDuration={250}>
      <Button
        type="button"
        variant="ghost"
        className={`nav-item${active ? " active" : ""}`}
        title={tooltip ?? label}
        aria-current={active ? "page" : undefined}
        disabled={disabled}
        onClick={onClick}
      >
        {icon}
        <span className="nav-item-label">{label}</span>
      </Button>
    </Tooltip>
  );
}
