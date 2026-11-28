import type { ReactNode } from "react";

export type ListRowProps = { title: string; description?: string; leading?: ReactNode; trailing?: ReactNode; selected?: boolean; disabled?: boolean; onClick?: () => void; className?: string };
export function ListRow({ title, description, leading, trailing, selected, disabled, onClick, className = "" }: ListRowProps) {
  const content = <>{leading && <span className="aos-list-leading">{leading}</span>}<span className="aos-list-copy"><span className="aos-list-title">{title}</span>{description && <span className="aos-list-description">{description}</span>}</span>{trailing && <span className="aos-list-trailing">{trailing}</span>}</>;
  const classes = `aos-list-row${selected ? " is-selected" : ""} ${className}`;
  return onClick ? <button type="button" className={classes} disabled={disabled} aria-pressed={selected} onClick={onClick}>{content}</button> : <div className={classes} aria-disabled={disabled || undefined}>{content}</div>;
}
export default ListRow;
