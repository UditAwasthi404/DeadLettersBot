/** Ollama provider — local HTTP API at OLLAMA_BASE_URL (no extra deps). */

import type { ModelMessage } from "@agentOS/shared";
import type {
  InferencePurpose,
  InferenceSession,
  InferenceStreamEvent,
  InferenceTool,
  ProviderFactory,
} from "../session.ts";

const DEFAULT_MAIN = "llama3.2";
const DEFAULT_SUMMARY = "llama3.2";

function baseUrl(): string {
  return process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
}

function toOllamaMessages(messages: ModelMessage[]) {
  return messages.map((m) => {
    if (m.role === "tool") {
      return { role: "tool" as const, content: m.content, tool_name: m.name };
    }
    if (m.role === "assistant" && m.toolCalls?.length) {
      return {
        role: "assistant" as const,
        content: m.content,
        tool_calls: m.toolCalls.map((tc) => ({
          function: { name: tc.name, arguments: tc.args },
        })),
      };
    }
    return { role: m.role, content: m.content };
  });
}

function toOllamaTools(tools: InferenceTool[] | undefined) {
  if (!tools?.length) return undefined;
  return tools.map((t) => ({
    type: "function",
    function: {
      name: t.name,
      description: t.description,
      // shortcut: full JSON-schema from Zod lands with agent-core; Ollama accepts empty props
      parameters: { type: "object", properties: {} },
    },
  }));
}

export class OllamaSession implements InferenceSession {
  readonly providerId = "ollama";
  readonly purpose: InferencePurpose;
  private readonly modelId: string;
  private readonly base: string;

  constructor(purpose: InferencePurpose, modelId?: string, base = baseUrl()) {
    this.purpose = purpose;
    this.modelId = modelId ?? (purpose === "summarization" ? DEFAULT_SUMMARY : DEFAULT_MAIN);
    this.base = base.replace(/\/$/, "");
  }

  async *streamComplete(
    messages: ModelMessage[],
    tools?: InferenceTool[],
  ): AsyncIterable<InferenceStreamEvent> {
    const res = await fetch(`${this.base}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: this.modelId,
        messages: toOllamaMessages(messages),
        stream: true,
        tools: toOllamaTools(tools),
      }),
    });
    if (!res.ok || !res.body) {
      throw Object.assign(new Error(`Ollama HTTP ${res.status}`), { status: res.status });
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    let toolCallSeq = 0;
    let promptTokens = 0;
    let completionTokens = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        let chunk: {
          message?: {
            content?: string;
            tool_calls?: Array<{ function?: { name?: string; arguments?: unknown } }>;
          };
          prompt_eval_count?: number;
          eval_count?: number;
        };
        try {
          chunk = JSON.parse(trimmed);
        } catch {
          continue;
        }
        if (typeof chunk.prompt_eval_count === "number") promptTokens = chunk.prompt_eval_count;
        if (typeof chunk.eval_count === "number") completionTokens = chunk.eval_count;
        const content = chunk.message?.content;
        if (content) yield { type: "token", delta: content };
        for (const tc of chunk.message?.tool_calls ?? []) {
          const name = tc.function?.name ?? "unknown";
          const args = (tc.function?.arguments ?? {}) as Record<string, unknown>;
          toolCallSeq += 1;
          yield {
            type: "toolCall",
            toolCall: { id: `ollama-${toolCallSeq}`, name, args },
          };
        }
      }
    }
    if (promptTokens > 0 || completionTokens > 0) {
      yield {
        type: "usage",
        usage: {
          promptTokens,
          completionTokens,
          totalTokens: promptTokens + completionTokens,
          source: "provider",
        },
      };
    }
  }
}

export const ollamaProvider: ProviderFactory = {
  id: "ollama",
  createSession(purpose, model) {
    return new OllamaSession(purpose, model);
  },
};
