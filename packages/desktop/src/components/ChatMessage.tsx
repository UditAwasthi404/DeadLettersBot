import { Button } from "@radix-ui/themes";
import { Check, Copy, Wrench } from "lucide-react";
import * as React from "react";
import { AgentAvatar } from "./AgentAvatar.tsx";

const AssistantMarkdown = React.lazy(() => import("../AssistantMarkdown.tsx"));

export type ChatMessageData = {
  id: string;
  role: "user" | "assistant" | "tool";
  content: string;
  toolName?: string;
  approval?: { actionId: string; permissionLevel: number };
};

type ChatMessageProps = {
  item: ChatMessageData;
  index: number;
  botName: string;
  onDecide: (item: ChatMessageData, decision: "allow_once" | "always_allow" | "deny") => void;
  onError: (error: unknown) => void;
};

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = React.useState(false);
  return (
    <Button
      type="button"
      className={`copy-button${copied ? " is-copied" : ""}`}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1600);
        } catch {
          // Clipboard access can be denied; leave the label unchanged.
        }
      }}
    >
      {copied ? <Check size={12} aria-hidden="true" /> : <Copy size={12} aria-hidden="true" />}
      {copied ? "Copied" : "Copy"}
    </Button>
  );
}

export function ChatMessage({ item, index, botName, onDecide, onError }: ChatMessageProps) {
  if (item.role === "tool") {
    return (
      <article className="message tool" style={{ "--stagger": index } as React.CSSProperties}>
        <details open={item.approval !== undefined}>
          <summary>
            <Wrench size={13} aria-hidden="true" />
            {item.toolName}
          </summary>
          <pre>{item.content}</pre>
          {item.approval && (
            <div className="approval-actions">
              <Button type="button" onClick={() => onDecide(item, "allow_once")}>
                Allow once
              </Button>
              <Button type="button" onClick={() => onDecide(item, "always_allow")}>
                Always allow
              </Button>
              <Button type="button" className="deny" onClick={() => onDecide(item, "deny")}>
                Deny
              </Button>
            </div>
          )}
        </details>
      </article>
    );
  }

  const assistant = item.role === "assistant";
  return (
    <article
      className={`message ${item.role}`}
      style={{ "--stagger": index } as React.CSSProperties}
    >
      <div className="message-bubble">
        <div className="message-label">
          <AgentAvatar kind={assistant ? "agent" : "user"} name={botName} size="sm" />
          <span>{assistant ? botName : "You"}</span>
          {assistant && <CopyButton text={item.content} />}
        </div>
        <div className={`message-content${assistant ? " markdown-content" : ""}`}>
          {assistant ? (
            <React.Suspense fallback={<span className="markdown-loading">Formatting reply…</span>}>
              <AssistantMarkdown content={item.content} onError={onError} />
            </React.Suspense>
          ) : (
            item.content
          )}
        </div>
      </div>
    </article>
  );
}
