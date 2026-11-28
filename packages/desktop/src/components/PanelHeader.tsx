import type * as React from "react";

export function PanelHeader({
  title,
  subtitle,
  children,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className="memory-toolbar">
      <div className="panel-heading">
        <h2>{title}</h2>
        {subtitle && <p className="page-subtitle">{subtitle}</p>}
      </div>
      {children && <div className="panel-actions">{children}</div>}
    </div>
  );
}
