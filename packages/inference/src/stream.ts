import { incrementCounter } from "@agentOS/shared";
import type { OutputInterface, StreamTextResult, ToolSet } from "ai";
import type { InferenceStreamEvent } from "./session.ts";

/** Map Vercel AI SDK fullStream parts → token | toolCall events. */
export async function* mapFullStream(
  result: StreamTextResult<
    ToolSet,
    Record<string, unknown>,
    OutputInterface<string, string, never>
  >,
  providerId: string,
): AsyncIterable<InferenceStreamEvent> {
  for await (const part of result.fullStream) {
    if (part.type === "error") {
      const error = part.error;
      throw error instanceof Error
        ? error
        : new Error(typeof error === "string" ? error : "inference request failed");
    }
    if (part.type === "text-delta") {
      yield { type: "token", delta: part.text };
    } else if (part.type === "tool-call") {
      yield {
        type: "toolCall",
        toolCall: {
          id: part.toolCallId,
          name: part.toolName,
          args: part.input as Record<string, unknown>,
        },
      };
    }
  }
  try {
    const usage = await result.usage;
    const promptTokens = usage.inputTokens ?? 0;
    const completionTokens = usage.outputTokens ?? 0;
    const cachedPromptTokens = usage.inputTokenDetails.cacheReadTokens ?? 0;
    const cacheWritePromptTokens = usage.inputTokenDetails.cacheWriteTokens ?? 0;
    incrementCounter("agentos_prompt_input_tokens_total", { provider: providerId }, promptTokens);
    if (cachedPromptTokens) {
      incrementCounter(
        "agentos_prompt_cache_read_tokens_total",
        { provider: providerId },
        cachedPromptTokens,
      );
    }
    if (cacheWritePromptTokens) {
      incrementCounter(
        "agentos_prompt_cache_write_tokens_total",
        { provider: providerId },
        cacheWritePromptTokens,
      );
    }
    yield {
      type: "usage",
      usage: {
        promptTokens,
        completionTokens,
        totalTokens: usage.totalTokens ?? promptTokens + completionTokens,
        ...(cachedPromptTokens ? { cachedPromptTokens } : {}),
        ...(cacheWritePromptTokens ? { cacheWritePromptTokens } : {}),
        source: "provider",
      },
    };
  } catch {
    // The runner keeps its estimate when the provider does not report usage.
  }
}
