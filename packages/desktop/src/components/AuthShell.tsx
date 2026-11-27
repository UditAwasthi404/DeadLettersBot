import { Check } from "lucide-react";
import type * as React from "react";

const POINTS = [
  "Sessions stay on this computer",
  "Sensitive actions wait for your approval",
  "Switch bots without losing the thread",
];

export function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <section className="auth-gate" aria-label="Account">
      <div className="auth-stage">
        <div className="auth-hero">
          <div className="auth-mark" aria-hidden="true">
            A
          </div>
          <h1>AgentOS</h1>
          <p className="auth-promise">
            A quieter place to run agents — conversations, tools, and approvals in one calm
            workspace.
          </p>
          <ul className="auth-points">
            {POINTS.map((point) => (
              <li key={point}>
                <Check size={14} strokeWidth={2.4} aria-hidden="true" />
                {point}
              </li>
            ))}
          </ul>
        </div>
        {children}
      </div>
    </section>
  );
}
