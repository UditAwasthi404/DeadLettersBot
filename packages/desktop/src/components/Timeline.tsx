import type { ReactNode } from "react";
import { useId } from "react";

export type TimelineEvent = { id: string; title: string; time: string; dateTime?: string; description?: string; icon?: ReactNode; tone?: "neutral" | "accent" | "success" | "warning" | "danger" };
export type TimelineProps = { events: readonly TimelineEvent[]; title?: string; className?: string };
export function Timeline({ events, title = "Activity", className = "" }: TimelineProps) {
  const id = useId();
  return <section aria-labelledby={id} className={`aos-timeline ${className}`}><h3 id={id}>{title}</h3>
    <ol>{events.map((event) => <li key={event.id}>
      <span aria-hidden="true" className={`aos-timeline-dot aos-tone--${event.tone ?? "neutral"}`}>{event.icon}</span>
      <div className="aos-timeline-copy"><div className="aos-timeline-heading"><strong>{event.title}</strong><time dateTime={event.dateTime}>{event.time}</time></div>
        {event.description && <p className="aos-field-hint">{event.description}</p>}
      </div>
    </li>)}</ol>
  </section>;
}
export default Timeline;
