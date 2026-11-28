import { ShieldAlert } from "lucide-react";
import { useId } from "react";
import { Button } from "./Button.tsx";
import { Kbd } from "./Kbd.tsx";

export type ApprovalCardProps = { action: string; description?: string; onAllow: () => void; onDeny: () => void; pending?: boolean; decision?: "allowed" | "denied"; className?: string };
export function ApprovalCard({ action, description, onAllow, onDeny, pending = false, decision, className = "" }: ApprovalCardProps) {
  const id = useId();
  const disabled = pending || Boolean(decision);
  return <article tabIndex={0} aria-labelledby={`${id}-title`} aria-describedby={`${id}-action`} className={`aos-approval-card ${className}`}
    onKeyDown={(event) => {
      if (disabled || event.repeat || event.defaultPrevented || event.nativeEvent.isComposing || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      if (!(event.target instanceof HTMLElement) || !event.currentTarget.contains(event.target)) return;
      // Portal overlays and editable controls own their shortcuts; buttons retain native Enter.
      if (event.target.closest("input, textarea, select, a, [contenteditable='true'], [role='combobox'], [role='menuitem'], [role='separator'], [role='radio'], [role='tab']")) return;
      if (event.key === "Enter" && event.target.closest("button, [role='button']")) return;
      if (event.key === "Enter") { event.preventDefault(); event.stopPropagation(); onAllow(); }
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onDeny(); }
    }}>
    <div className="aos-card-title"><ShieldAlert aria-hidden="true" /><h3 id={`${id}-title`}>Approval required</h3></div>
    {description && <p className="aos-field-hint">{description}</p>}
    <pre id={`${id}-action`} className="aos-approval-action">{action}</pre>
    {decision ? <p role="status">{decision === "allowed" ? "Action allowed" : "Action denied"}</p> : <>
      <p className="aos-field-hint">Focus this card: <Kbd>Enter</Kbd> allows; <Kbd>Esc</Kbd> denies.</p>
      <div className="aos-inline"><Button variant="secondary" disabled={disabled} onClick={onDeny}>Deny</Button><Button loading={pending} disabled={disabled} onClick={onAllow}>Allow exact action</Button></div>
    </>}
  </article>;
}
export default ApprovalCard;
