/** Anthropic provider — claude-sonnet-4, same InferenceSession interface. */

import type { ModelMessage } from "@agentOS/shared";
import { createAnthropic } from "@ai-sdk/anthropic";
import { stepCountIs, streamText } from "ai";
import { toCoreMessages, toToolSet } from "../convert.ts";
import type {
  InferencePurpose,
  InferenceSession,
  InferenceStreamEvent,
  InferenceTool,
  ProviderFactory,
} from "../session.ts";
import { mapFullStream } from "../stream.ts";

const DEFAULT_MAIN = "claude-sonnet-4-20250514";
const DEFAULT_SUMMARY = "claude-sonnet-4-20250514";

export class AnthropicSession implements InferenceSession {
  readonly providerId = "anthropic";
  readonly purpose: InferencePurpose;
  private readonly modelId: string;
  private readonly client: ReturnType<typeof createAnthropic>;

  constructor(purpose: InferencePurpose, modelId?: string, apiKey = process.env.ANTHROPIC_API_KEY) {
    this.purpose = purpose;
    this.modelId = modelId ?? (purpose === "summarization" ? DEFAULT_SUMMARY : DEFAULT_MAIN);
    this.client = createAnthropic({ apiKey });
  }

  async *streamComplete(
    messages: ModelMessage[],
    tools?: InferenceTool[],
  ): AsyncIterable<InferenceStreamEvent> {
    if (messages.length === 0) {
      yield {
        type: "usage",
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0, source: "estimate" },
      };
      return;
    }
    const result = streamText({
      model: this.client(this.modelId),
      allowSystemInMessages: true,
      messages: toCoreMessages(messages),
      tools: toToolSet(tools),
      stopWhen: stepCountIs(1),
    });
    yield* mapFullStream(result);
  }
}

export const anthropicProvider: ProviderFactory = {
  id: "anthropic",
  createSession(purpose, model) {
    return new AnthropicSession(purpose, model);
  },
};
