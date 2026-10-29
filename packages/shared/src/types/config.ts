/** AGENTS.md §6 BotConfig schema. */

import type { AutoReviewRule, PermissionLevel } from "./bot.ts";

export type ToolCategory =
  | "delivery"
  | "file"
  | "shell"
  | "browser"
  | "web"
  | "memory"
  | "agent"
  | "approval"
  | "connector"
  | "mcp";

export interface BotConfig {
  id: string;
  accountId: string;
  name: string;
  role: "main" | "peer" | "chief_of_staff";

  persona: {
    systemPrompt: string;
    profileText: string;
    tone?: "professional" | "casual" | "concise";
  };

  tools: {
    allowedCategories: ToolCategory[];
    deniedTools: string[];
    requireApprovalTools: string[];
    localMachineAccess: "never" | "always_confirm" | "always_allow";
  };

  memory: {
    agentScopeEnabled: boolean;
    userScopeEnabled: boolean;
    projectScopeEnabled: boolean;
    projectId?: string;
    synthesisEnabled: boolean;
  };

  skills: string[];

  scheduling: {
    maxConcurrentTurns: number;
    stepBudget: number;
    tokenBudget: number;
    backgroundInterruptible: boolean;
  };

  approvalPolicy: {
    autoReviewRules: AutoReviewRule[];
    defaultLevel: PermissionLevel;
  };

  peers: {
    canReceiveFromBots: string[];
    canSendToBots: string[];
    hopBudget: number;
    conservativeReplies: boolean;
  };
}
