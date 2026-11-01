/** OpenAI provider — gpt-4o, streaming + tool calls (REQ-I01/I02). */

import type { ModelMessage } from "@agentOS/shared";
import { createOpenAI } from "@ai-sdk/openai";
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

const DEFAULT_MAIN = "gpt-4o";
const DEFAULT_SUMMARY = "gpt-4o-mini";

export class OpenAISession implements InferenceSession {
  readonly providerId = "openai";
  readonly purpose: InferencePurpose;
  private readonly modelId: string;
  private readonly client: ReturnType<typeof createOpenAI>;

  constructor(purpose: InferencePurpose, modelId?: string, apiKey = process.env.OPENAI_API_KEY) {
    this.purpose = purpose;
    this.modelId = modelId ?? (purpose === "summarization" ? DEFAULT_SUMMARY : DEFAULT_MAIN);
    this.client = createOpenAI({ apiKey });
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

export const openaiProvider: ProviderFactory = {
  id: "openai",
  createSession(purpose, model) {
    return new OpenAISession(purpose, model);
  },
};
