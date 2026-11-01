/** xAI provider — OpenAI-compatible API, xAI compaction carrier via providerId. */

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

const DEFAULT_MAIN = "grok-4";
const DEFAULT_SUMMARY = "grok-3-mini";

export class XaiSession implements InferenceSession {
  readonly providerId = "xai";
  readonly purpose: InferencePurpose;
  private readonly modelId: string;
  private readonly client: ReturnType<typeof createOpenAI>;

  constructor(
    purpose: InferencePurpose,
    modelId?: string,
    apiKey = process.env.XAI_API_KEY,
    baseURL = process.env.XAI_BASE_URL ?? "https://api.x.ai/v1",
  ) {
    this.purpose = purpose;
    this.modelId = modelId ?? (purpose === "summarization" ? DEFAULT_SUMMARY : DEFAULT_MAIN);
    this.client = createOpenAI({ apiKey, baseURL });
  }

  async *streamComplete(
    messages: ModelMessage[],
    tools?: InferenceTool[],
  ): AsyncIterable<InferenceStreamEvent> {
    // Startup readiness probes with an empty transcript. The SDK rejects that shape.
    if (messages.length === 0) {
      yield {
        type: "usage",
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0, source: "estimate" },
      };
      return;
    }
    const result = streamText({
      // xAI serves Chat Completions. The SDK's default model uses OpenAI's Responses API.
      model: this.client.chat(this.modelId),
      // Conversation history keeps the system prompt, and compaction can insert later system items.
      allowSystemInMessages: true,
      messages: toCoreMessages(messages),
      tools: toToolSet(tools),
      stopWhen: stepCountIs(1),
    });
    yield* mapFullStream(result);
  }
}

export const xaiProvider: ProviderFactory = {
  id: "xai",
  createSession(purpose, model) {
    return new XaiSession(purpose, model);
  },
};
