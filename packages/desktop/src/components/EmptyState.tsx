import type * as React from "react";

type EmptyStateProps = {
  icon: React.ComponentType<{ size?: number | string; className?: string }>;
  title: string;
  description?: string;
  action?: React.ReactNode;
  compact?: boolean;
};

export function EmptyState({ icon: Icon, title, description, action, compact }: EmptyStateProps) {
  return (
    <div className={`empty-state${compact ? " empty-state--compact" : ""}`}>
      <span className="empty-state-icon">
        <Icon size={compact ? 16 : 20} />
      </span>
      <div className="empty-state-copy">
        <strong>{title}</strong>
        {description && <p>{description}</p>}
      </div>
      {action && <div className="empty-state-action">{action}</div>}
    </div>
  );
}
