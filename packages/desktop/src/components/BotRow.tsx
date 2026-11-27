import { Button } from "@radix-ui/themes";
import { AgentAvatar } from "./AgentAvatar.tsx";

export function BotRow({
  name,
  role,
  selected,
  onClick,
}: {
  name: string;
  role: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      className={`bot-row${selected ? " selected" : ""}`}
      title={`${name} · ${role}`}
      aria-label={`${name}, ${role}`}
      aria-pressed={selected}
      onClick={onClick}
    >
      <AgentAvatar name={name} />
      <span className="bot-name">
        {name}
        <small>{role}</small>
      </span>
    </Button>
  );
}
