/** TRD §3.2 + ARCHITECTURE.md §9 WebSocket gateway frames. */

import type { Attachment, TokenUsage } from "./turn.ts";

export type ApprovalDecision = "allow_once" | "deny" | "always_allow";

/** Client → Server */

export interface SendPromptFrame {
  type: "sendPrompt";
  agentId: string;
  prompt: string;
  attachments: Attachment[];
  nonce: string;
  routingOptions?: {
    machineId?: string;
    priority?: boolean;
  };
}

export interface InterruptFrame {
  type: "interrupt";
  agentId: string;
  runId: string;
}

export interface ApproveFrame {
  type: "approve";
  agentId: string;
  runId: string;
  actionId: string;
  decision: ApprovalDecision;
}

export interface ReturnToBotFrame {
  type: "returnToBot";
  agentId: string;
  runId: string;
}

export interface LocalExecResultFrame {
  type: "localExecResult";
  runId: string;
  actionId: string;
  stdout: string;
  stderr: string;
  exitCode: number;
}

export type ClientFrame =
  | SendPromptFrame
  | InterruptFrame
  | ApproveFrame
  | ReturnToBotFrame
  | LocalExecResultFrame;

/** Server → Client */

export interface AcceptedFrame {
  type: "accepted";
  echoId: string;
  nonce: string;
}

export interface TokenFrame {
  type: "token";
  agentId: string;
  runId: string;
  delta: string;
}

export interface ToolStartFrame {
  type: "toolStart";
  agentId: string;
  runId: string;
  toolName: string;
  params: Record<string, unknown>;
}

export interface ToolEndFrame {
  type: "toolEnd";
  agentId: string;
  runId: string;
  toolName: string;
  result: unknown;
}

export interface ApprovalRequiredFrame {
  type: "approvalRequired";
  agentId: string;
  runId: string;
  actionId: string;
  actionDescription: string;
}

export interface NeedsApprovalFrame {
  type: "needsApproval";
  agentId: string;
  runId: string;
  actionId: string;
  actionDescription: string;
  permissionLevel: number;
}

export interface MessageFrame {
  type: "message";
  agentId: string;
  runId: string;
  content: string;
  endTurn: boolean;
}

export interface SettledFrame {
  type: "settled";
  agentId: string;
  runId: string;
  usage: TokenUsage;
}

export interface ErrorFrame {
  type: "error";
  agentId: string;
  runId: string;
  code: string;
  message: string;
}

export interface SecureHandoffFrame {
  type: "secureHandoff";
  agentId: string;
  runId: string;
  reason: string;
}

export interface LocalExecRequestFrame {
  type: "localExecRequest";
  agentId: string;
  runId: string;
  actionId: string;
  command: string;
  cwd?: string;
}

export type ServerFrame =
  | AcceptedFrame
  | TokenFrame
  | ToolStartFrame
  | ToolEndFrame
  | ApprovalRequiredFrame
  | NeedsApprovalFrame
  | MessageFrame
  | SettledFrame
  | ErrorFrame
  | SecureHandoffFrame
  | LocalExecRequestFrame;

export type WsFrame = ClientFrame | ServerFrame;
