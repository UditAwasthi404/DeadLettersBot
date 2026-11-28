import { Check, Circle, Minus, X } from "lucide-react";
import { useId } from "react";
import { Spinner } from "./Spinner.tsx";

export type PlanStepState = "pending" | "running" | "completed" | "failed" | "skipped";
export type PlanStep = { id: string; title: string; state: PlanStepState; detail?: string };
export type PlanChecklistProps = { steps: readonly PlanStep[]; title?: string; className?: string };
export function PlanChecklist({ steps, title = "Plan", className = "" }: PlanChecklistProps) {
  const id = useId();
  const completed = steps.filter((step) => step.state === "completed").length;
  return <section aria-labelledby={id} className={`aos-plan ${className}`}>
    <div className="aos-plan-heading"><h3 id={id}>{title}</h3><span className="aos-field-hint" role="status">{completed} of {steps.length} complete</span></div>
    <ol className="aos-plan-list">{steps.map((step) => <li key={step.id} className={`aos-plan-step aos-plan-step--${step.state}`} aria-current={step.state === "running" ? "step" : undefined}>
      <span className="aos-plan-icon" aria-hidden="true">{step.state === "running" ? <Spinner /> : step.state === "completed" ? <Check /> : step.state === "failed" ? <X /> : step.state === "skipped" ? <Minus /> : <Circle />}</span>
      <div><span className="aos-plan-step-title">{step.title}</span><span className="aos-sr-only"> — {step.state}</span>{step.detail && <p className="aos-field-hint">{step.detail}</p>}</div>
    </li>)}</ol>
  </section>;
}
export default PlanChecklist;
