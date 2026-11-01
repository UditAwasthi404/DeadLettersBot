/** Model / tool message shapes used by turns and inference (TRD §5.2). */

export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export interface ToolResult {
  toolCallId: string;
  name: string;
  result: unknown;
  isError?: boolean;
}

export type ModelMessageRole = "system" | "user" | "assistant" | "tool";

export interface ModelMessage {
  role: ModelMessageRole;
  content: string;
  toolCalls?: ToolCall[];
  toolCallId?: string;
  name?: string;
  /** Summary carrier inserted by compaction. It is context, not a new user instruction. */
  isSummary?: boolean;
}
