export type LivePillProps = { live?: boolean; label?: string; className?: string };
export function LivePill({ live = true, label, className = "" }: LivePillProps) {
  return <span role="status" aria-live="polite" className={`aos-live-pill${live ? " is-live" : ""} ${className}`}>
    <span aria-hidden="true" className="aos-live-dot" />{label ?? (live ? "Live" : "Offline")}
  </span>;
}
export default LivePill;
