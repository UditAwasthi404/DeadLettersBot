/** Model / tool message shapes used by turns and inference (TRD §5.2). */

export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export interface ModelImage {
  mediaType: "image/jpeg" | "image/png" | "image/webp";
  /** Base64 payload without a data: URL prefix. */
  data: string;
}

export interface ToolResult {
  toolCallId: string;
  name: string;
  result: unknown;
  isError?: boolean;
  /** Vision attachment. Omitted from stored transcripts. */
  images?: ModelImage[];
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
  /** Latest screenshot for a vision-capable provider. Not stored in checkpoints. */
  images?: ModelImage[];
}
