/** REQ-I01/I02: provider-agnostic InferenceSession (BUILD_PLAN Track B). */

import type { ModelMessage, ToolCall } from "@agentOS/shared";
import type { ZodTypeAny } from "zod";

export type InferencePurpose = "main" | "summarization";

export interface InferenceTool {
  name: string;
  description: string;
  parameters: ZodTypeAny;
}

export type InferenceStreamEvent =
  | { type: "token"; delta: string }
  | { type: "toolCall"; toolCall: ToolCall };

export interface InferenceSession {
  readonly purpose: InferencePurpose;
  readonly providerId: string;
  streamComplete(
    messages: ModelMessage[],
    tools?: InferenceTool[],
  ): AsyncIterable<InferenceStreamEvent>;
}

export interface ProviderFactory {
  readonly id: string;
  createSession(purpose: InferencePurpose, model?: string): InferenceSession;
}
