import { Bot, User, Wrench } from "lucide-react";

export type AvatarKind = "agent" | "user" | "tool";

const ICONS = { agent: Bot, user: User, tool: Wrench } as const;

function toneFor(seed: string): number {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) | 0;
  }
  return Math.abs(hash) % 4;
}

export function AgentAvatar({
  name,
  kind = "agent",
  size = "md",
  className,
}: {
  name?: string;
  kind?: AvatarKind;
  size?: "sm" | "md";
  className?: string;
}) {
  const Icon = ICONS[kind];
  const tone = kind === "agent" ? toneFor(name ?? "agent") : 0;
  return (
    <span
      className={`agent-avatar agent-avatar--${kind} agent-avatar--${size} tone-${tone}${className ? ` ${className}` : ""}`}
      aria-hidden="true"
    >
      <Icon size={size === "sm" ? 12 : 15} />
    </span>
  );
}
