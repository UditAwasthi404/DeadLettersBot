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
}
