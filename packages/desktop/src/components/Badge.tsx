import type { HTMLAttributes } from "react";
export type BadgeProps = HTMLAttributes<HTMLSpanElement> & { tone?: "neutral" | "accent" | "success" | "warning" | "danger" };
export function Badge({ tone = "neutral", className = "", ...props }: BadgeProps) {
  return <span {...props} className={`aos-badge aos-tone--${tone} ${className}`} />;
}
export default Badge;
