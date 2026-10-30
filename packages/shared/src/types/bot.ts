/** TRD §5.1 Bot + supporting approval types (BUILD_PLAN Phase 2 AutoReviewRule). */

export type PermissionLevel = 0 | 1 | 2 | 3;

export interface AutoReviewRule {
  actionPattern: string;
  mode: "require" | "always_allow";
}

export interface ApprovalPolicy {
  autoReviewRules: AutoReviewRule[];
  defaultLevel: PermissionLevel;
}

export interface BotMemorySettings {
  agentScope: boolean;
  userScope: boolean;
  projectScope: boolean;
  projectId?: string;
}

export interface Bot {
  id: string;
  accountId: string;
  name: string;
  systemPrompt: string;
  profileText: string;
  role: "main" | "peer" | "subagent";
  skills: string[];
  tools: string[];
  /** Runs on the connected desktop. Missing rows default to always_confirm. */
  localMachineAccess?: "never" | "always_confirm" | "always_allow";
  /** Stored preference. This self-hosted build does not upload conversation data. */
  retainData?: boolean;
  memorySettings: BotMemorySettings;
  approvalSettings: ApprovalPolicy;
  createdAt: Date;
  updatedAt: Date;
}
