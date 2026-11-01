/** TRD §5.2 Turn / Step. */

import type { ModelMessage, ToolCall, ToolResult } from "./messages.ts";

export interface Attachment {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  /** Blob store key or inline data URI for small payloads. */
  uri: string;
}

export interface TurnInput {
  prompt: string;
  attachments: Attachment[];
  nonce: string;
  senderBotId?: string;
  hopCount?: number;
  priority?: boolean;
  skillId?: string;
  routineId?: string;
  routineRunId?: string;
  retryAttempt?: number;
  subagentId?: string;
  stepBudget?: number;
  /** Last durable in-turn checkpoint, used to resume interrupted turns. */
  resumeCheckpointBlobId?: string;
  resumeStepIndex?: number;
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  /** Provider-reported totals, or a local estimate when the provider sent none. */
  source?: "provider" | "estimate";
}

export type TurnType = "user" | "peer" | "routine" | "wake" | "subagent";
export type TurnState = "pending" | "running" | "settled" | "cancelled" | "error";

export interface Step {
  id: string;
  turnId: string;
  index: number;
  modelMessages: ModelMessage[];
  toolCalls: ToolCall[];
  toolResults: ToolResult[];
  checkpointBlobId?: string;
  createdAt: Date;
}

export interface Turn {
  id: string;
  botId: string;
  runId: string;
  type: TurnType;
  input: TurnInput;
  state: TurnState;
  steps: Step[];
  checkpointRootId?: string;
  summaryArchiveId?: string;
  usage?: TokenUsage;
  createdAt: Date;
  settledAt?: Date;
}
