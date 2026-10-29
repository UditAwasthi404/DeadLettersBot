import type { ModelMessage } from "@agentOS/shared";
import type { ModelMessage as AIModelMessage, Tool, ToolSet } from "ai";
import { tool } from "ai";
import type { InferenceTool } from "./session.ts";

export function toCoreMessages(messages: ModelMessage[]): AIModelMessage[] {
  return messages.map((m): AIModelMessage => {
    if (m.role === "tool") {
      return {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: m.toolCallId ?? "",
            toolName: m.name ?? "",
            output: { type: "text", value: m.content },
          },
        ],
      };
    }
    if (m.role === "assistant" && m.toolCalls?.length) {
      return {
        role: "assistant",
        content: [
          ...(m.content ? [{ type: "text" as const, text: m.content }] : []),
          ...m.toolCalls.map((tc) => ({
            type: "tool-call" as const,
            toolCallId: tc.id,
            toolName: tc.name,
            input: tc.args,
          })),
        ],
      };
    }
    return {
      role: m.role as "system" | "user" | "assistant",
      content: m.content,
    };
  });
}

export function toToolSet(tools: InferenceTool[] | undefined): ToolSet | undefined {
  if (!tools?.length) return undefined;
  const set: Record<string, Tool> = {};
  for (const t of tools) {
    set[t.name] = tool({
      description: t.description,
      inputSchema: t.parameters,
    });
  }
  return set;
}
