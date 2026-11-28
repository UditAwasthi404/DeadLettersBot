import { ChevronDown, Wrench } from "lucide-react";
import { useId, useState } from "react";
import { Badge } from "./Badge.tsx";
import { CodeBlock } from "./CodeBlock.tsx";
import { Spinner } from "./Spinner.tsx";

export type ToolStatus = "pending" | "running" | "success" | "error";
export type ToolCardProps = { name: string; args?: unknown; result?: unknown; durationMs?: number; status?: ToolStatus; expanded?: boolean; defaultExpanded?: boolean; onExpandedChange?: (expanded: boolean) => void; className?: string };
function serialize(value: unknown): string {
  if (typeof value === "string") return value;
  try { return JSON.stringify(value, null, 2) ?? String(value); }
  catch { return "This value cannot be displayed as JSON."; }
}
export function ToolCard({ name, args, result, durationMs, status = "pending", expanded, defaultExpanded = false, onExpandedChange, className = "" }: ToolCardProps) {
  const [localExpanded, setLocalExpanded] = useState(defaultExpanded);
  const isExpanded = expanded ?? localExpanded;
  const id = useId();
  const duration = durationMs !== undefined && Number.isFinite(durationMs) ? `${(Math.max(0, durationMs) / 1000).toFixed(2)} s` : undefined;
  return <article className={`aos-tool-card ${className}`} aria-label={`${name} tool`}>
    <button type="button" className="aos-tool-heading" aria-expanded={isExpanded} aria-controls={`${id}-details`} onClick={() => {
      setLocalExpanded(!isExpanded); onExpandedChange?.(!isExpanded);
    }}>
      <Wrench aria-hidden="true" /><span className="aos-tool-name">{name}</span>
      {status === "running" && <Spinner label="Tool running" />}
      <Badge tone={status === "error" ? "danger" : status === "success" ? "success" : "neutral"}>{status}</Badge>
      {duration && <span className="aos-tool-duration" aria-label={`Duration ${duration}`}>{duration}</span>}
      <ChevronDown aria-hidden="true" className={isExpanded ? "aos-chevron is-expanded" : "aos-chevron"} />
    </button>
    {isExpanded && <div id={`${id}-details`} className="aos-tool-details">
      <section aria-label="Arguments"><h4>Arguments</h4><CodeBlock language="json" code={args === undefined ? "No arguments" : serialize(args)} /></section>
      <section aria-label="Result"><h4>Result</h4><CodeBlock language={typeof result === "string" ? "text" : "json"} code={result === undefined ? "No result yet" : serialize(result)} /></section>
    </div>}
  </article>;
}
export default ToolCard;
