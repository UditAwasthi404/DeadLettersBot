import { Button } from "@radix-ui/themes";
import { ArrowUpRight, Link2, ListChecks, Sparkles } from "lucide-react";
import heroImage from "../assets/welcome-hero.webp";

const SUGGESTIONS = [
  { label: "Summarize what you can do", Icon: Sparkles },
  { label: "Check my connected accounts", Icon: Link2 },
  { label: "Plan the next routine", Icon: ListChecks },
];

export function Welcome({
  botName,
  disabled,
  onPick,
}: {
  botName?: string;
  disabled: boolean;
  onPick: (suggestion: string) => void;
}) {
  return (
    <div className="welcome">
      <div className="welcome-hero">
        <img src={heroImage} alt="" />
        <span className="welcome-hero-glow" aria-hidden="true" />
      </div>
      <span className="welcome-eyebrow">
        <span className="welcome-eyebrow-dot" aria-hidden="true" />
        {botName ? `${botName} is ready` : "AgentOS workspace"}
      </span>
      <h1>{botName ? `Message ${botName}` : "What can I help with?"}</h1>
      <p>
        Send a task to the selected agent. Tool activity, files, and approval requests stay in this
        conversation.
      </p>
      <div className="suggestion-row">
        {SUGGESTIONS.map(({ label, Icon }) => (
          <Button
            key={label}
            type="button"
            variant="ghost"
            disabled={disabled}
            onClick={() => onPick(label)}
          >
            <Icon size={14} aria-hidden="true" />
            {label}
            <ArrowUpRight size={13} className="suggestion-arrow" aria-hidden="true" />
          </Button>
        ))}
      </div>
    </div>
  );
}
