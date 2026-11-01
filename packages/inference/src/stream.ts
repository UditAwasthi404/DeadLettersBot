import type { OutputInterface, StreamTextResult, ToolSet } from "ai";
import type { InferenceStreamEvent } from "./session.ts";

/** Map Vercel AI SDK fullStream parts → token | toolCall events. */
export async function* mapFullStream(
  result: StreamTextResult<
    ToolSet,
    Record<string, unknown>,
    OutputInterface<string, string, never>
  >,
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
    yield {
      type: "usage",
      usage: {
        promptTokens,
        completionTokens,
        totalTokens: usage.totalTokens ?? promptTokens + completionTokens,
        source: "provider",
      },
    };
  } catch {
    // The runner keeps its estimate when the provider does not report usage.
  }
}
