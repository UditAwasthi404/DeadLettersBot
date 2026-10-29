/** Dev/mock provider for INFERENCE_MOCK=1 (BUILD_PLAN credential-check mock mode). */

import type { ModelMessage } from "@agentOS/shared";
import type {
  InferencePurpose,
  InferenceSession,
  InferenceStreamEvent,
  InferenceTool,
  ProviderFactory,
} from "../session.ts";

export class MockSession implements InferenceSession {
  readonly providerId = "mock";
  readonly purpose: InferencePurpose;

  constructor(purpose: InferencePurpose) {
    this.purpose = purpose;
  }

  async *streamComplete(
    messages: ModelMessage[],
    _tools?: InferenceTool[],
  ): AsyncIterable<InferenceStreamEvent> {
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    const reply = lastUser?.content?.trim()
      ? `Mock reply: ${lastUser.content}`
      : "Mock reply: ready";
    yield { type: "token", delta: reply };
    yield {
      type: "toolCall",
      toolCall: {
        id: `mock-${crypto.randomUUID()}`,
        name: "SendToUser",
        args: { content: reply, endTurn: true },
      },
    };
  }
}

export const mockProvider: ProviderFactory = {
  id: "mock",
  createSession(purpose) {
    return new MockSession(purpose);
  },
};
