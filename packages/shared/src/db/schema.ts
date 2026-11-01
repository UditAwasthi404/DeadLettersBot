/**
 * PostgreSQL tables for Phase 1 Week 1: accounts, bots, turns, steps, audit_log.
 * Column shapes derived from TRD.md §5 + BUILD_PLAN audit_log fields.
 */
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const accounts = pgTable("accounts", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  /** Clerk user id (`user_...`). Null for accounts created by the local mock login. */
  clerkUserId: text("clerk_user_id").unique(),
  displayName: text("display_name"),
  /** Provider preference order: primary → secondary → tertiary. */
  inferenceProviders: jsonb("inference_providers").$type<string[]>().default([]).notNull(),
  sessionVersion: integer("session_version").notNull().default(0),
  lastActiveAt: timestamp("last_active_at", { withTimezone: true }).defaultNow().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const bots = pgTable(
  "bots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id),
    name: text("name").notNull(),
    systemPrompt: text("system_prompt").notNull().default(""),
    profileText: text("profile_text").notNull().default(""),
    role: text("role").$type<"main" | "peer" | "subagent">().notNull().default("main"),
    skills: jsonb("skills").$type<string[]>().notNull().default([]),
    tools: jsonb("tools").$type<string[]>().notNull().default([]),
    localMachineAccess: text("local_machine_access")
      .$type<"never" | "always_confirm" | "always_allow">()
      .notNull()
      .default("always_confirm"),
    retainData: boolean("retain_data").notNull().default(true),
    memorySettings: jsonb("memory_settings")
      .$type<{
        agentScope: boolean;
        userScope: boolean;
        projectScope: boolean;
        projectId?: string;
      }>()
      .notNull(),
    approvalSettings: jsonb("approval_settings")
      .$type<{
        autoReviewRules: { actionPattern: string; mode: "require" | "always_allow" }[];
        defaultLevel: 0 | 1 | 2 | 3;
      }>()
      .notNull(),
    inferenceSettings: jsonb("inference_settings")
      .$type<{ providerId?: string; model?: string }>()
      .notNull()
      .default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("bots_account_id_idx").on(t.accountId)],
);

export const turns = pgTable(
  "turns",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    botId: uuid("bot_id")
      .notNull()
      .references(() => bots.id),
    runId: text("run_id").notNull(),
    type: text("type").$type<"user" | "peer" | "routine" | "wake" | "subagent">().notNull(),
    input: jsonb("input")
      .$type<{
        prompt: string;
        attachments: unknown[];
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
        resumeCheckpointBlobId?: string;
        resumeStepIndex?: number;
      }>()
      .notNull(),
    state: text("state")
      .$type<"pending" | "running" | "settled" | "cancelled" | "error">()
      .notNull()
      .default("pending"),
    checkpointRootId: text("checkpoint_root_id"),
    summaryArchiveId: text("summary_archive_id"),
    usage: jsonb("usage").$type<{
      promptTokens: number;
      completionTokens: number;
      totalTokens: number;
      source?: "provider" | "estimate";
    }>(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    settledAt: timestamp("settled_at", { withTimezone: true }),
  },
  (t) => [
    index("turns_bot_id_idx").on(t.botId),
    index("turns_run_id_idx").on(t.runId),
    index("turns_state_idx").on(t.state),
  ],
);

export const steps = pgTable(
  "steps",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    turnId: uuid("turn_id")
      .notNull()
      .references(() => turns.id),
    index: integer("index").notNull(),
    modelMessages: jsonb("model_messages").$type<unknown[]>().notNull().default([]),
    toolCalls: jsonb("tool_calls").$type<unknown[]>().notNull().default([]),
    toolResults: jsonb("tool_results").$type<unknown[]>().notNull().default([]),
    checkpointBlobId: text("checkpoint_blob_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("steps_turn_id_idx").on(t.turnId)],
);

/** Append-only tool-execution audit (BUILD_PLAN Phase 2 fields; schema now). */
export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id),
    botId: uuid("bot_id").references(() => bots.id),
    turnId: uuid("turn_id").references(() => turns.id),
    toolName: text("tool_name").notNull(),
    paramsHash: text("params_hash").notNull(),
    machineId: text("machine_id"),
    approvalStatus: text("approval_status").$type<
      "not_required" | "pending" | "allow_once" | "deny" | "always_allow"
    >(),
    outcome: text("outcome").$type<"success" | "error" | "denied" | "cancelled">().notNull(),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    retained: boolean("retained").notNull().default(true),
  },
  (t) => [
    index("audit_log_account_id_idx").on(t.accountId),
    index("audit_log_created_at_idx").on(t.createdAt),
  ],
);

/** Memory facts are scoped to an account and optionally a bot/project. */
export const memories = pgTable(
  "memories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id),
    botId: uuid("bot_id").references(() => bots.id),
    projectId: text("project_id"),
    scope: text("scope").$type<"agent" | "user" | "project">().notNull(),
    content: text("content").notNull(),
    source: text("source").notNull(),
    sourceTurnId: uuid("source_turn_id").references(() => turns.id),
    isUserAuthored: boolean("is_user_authored").notNull().default(false),
    staleAfter: timestamp("stale_after", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("memories_account_scope_idx").on(t.accountId, t.scope),
    index("memories_bot_idx").on(t.botId),
    index("memories_project_idx").on(t.projectId),
  ],
);

/** Conversation turns supporting an automatically extracted memory fact. */
export const memoryEvidence = pgTable(
  "memory_evidence",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id),
    memoryId: uuid("memory_id")
      .notNull()
      .references(() => memories.id, { onDelete: "cascade" }),
    turnId: uuid("turn_id")
      .notNull()
      .references(() => turns.id),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("memory_evidence_memory_turn_idx").on(t.memoryId, t.turnId),
    index("memory_evidence_account_idx").on(t.accountId, t.createdAt),
  ],
);

/** Durable post-turn extraction jobs; conversation text remains in the blob store. */
export const memoryExtractionJobs = pgTable(
  "memory_extraction_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id),
    botId: uuid("bot_id")
      .notNull()
      .references(() => bots.id),
    turnId: uuid("turn_id")
      .notNull()
      .references(() => turns.id),
    status: text("status")
      .$type<"pending" | "processing" | "complete">()
      .notNull()
      .default("pending"),
    attemptCount: integer("attempt_count").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
    leaseUntil: timestamp("lease_until", { withTimezone: true }),
    leaseToken: text("lease_token"),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("memory_extraction_jobs_turn_idx").on(t.turnId),
    index("memory_extraction_jobs_due_idx").on(t.status, t.nextAttemptAt),
    index("memory_extraction_jobs_account_idx").on(t.accountId, t.createdAt),
  ],
);

/** Durable synthesis requests created after extraction discovers memory evidence. */
export const memorySynthesisJobs = pgTable(
  "memory_synthesis_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id),
    botId: uuid("bot_id")
      .notNull()
      .references(() => bots.id),
    turnId: uuid("turn_id")
      .notNull()
      .references(() => turns.id),
    status: text("status")
      .$type<"pending" | "processing" | "complete">()
      .notNull()
      .default("pending"),
    attemptCount: integer("attempt_count").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
    leaseUntil: timestamp("lease_until", { withTimezone: true }),
    leaseToken: text("lease_token"),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("memory_synthesis_jobs_turn_idx").on(t.turnId),
    index("memory_synthesis_jobs_due_idx").on(t.status, t.nextAttemptAt),
    index("memory_synthesis_jobs_account_idx").on(t.accountId, t.createdAt),
  ],
);

export const skills = pgTable(
  "skills",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id),
    ownerBotId: uuid("owner_bot_id").references(() => bots.id),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    steps: jsonb("steps")
      .$type<
        Array<{
          instruction: string;
          approvalRequired?: boolean;
          onError?: "stop" | "retry" | "skip" | "notify_user" | "custom_prompt";
          maxAttempts?: number;
          customPrompt?: string;
        }>
      >()
      .notNull()
      .default([]),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("skills_account_id_idx").on(t.accountId)],
);

export const skillVersions = pgTable(
  "skill_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    skillId: uuid("skill_id")
      .notNull()
      .references(() => skills.id),
    version: integer("version").notNull(),
    name: text("name").notNull(),
    description: text("description").notNull(),
    steps: jsonb("steps")
      .$type<
        Array<{
          instruction: string;
          approvalRequired?: boolean;
          onError?: "stop" | "retry" | "skip" | "notify_user" | "custom_prompt";
          maxAttempts?: number;
          customPrompt?: string;
        }>
      >()
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("skill_versions_skill_idx").on(t.skillId, t.version)],
);

export const routines = pgTable(
  "routines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id),
    botId: uuid("bot_id")
      .notNull()
      .references(() => bots.id),
    skillId: uuid("skill_id")
      .notNull()
      .references(() => skills.id),
    name: text("name").notNull(),
    trigger: jsonb("trigger")
      .$type<
        | { type: "cron"; schedule: string }
        | { type: "webhook"; secretHash?: string }
        | { type: "inter_bot_message"; senderBotId?: string }
        | { type: "file_change"; path: string }
        | {
            type: "connector_event";
            service: "gmail" | "google-calendar";
            sender?: string;
            subject?: string;
            query?: string;
            calendarId?: string;
          }
      >()
      .notNull(),
    enabled: boolean("enabled").notNull().default(true),
    onError: text("on_error").$type<"notify_user" | "retry" | "pause">().notNull().default("pause"),
    lastTriggeredAt: timestamp("last_triggered_at", { withTimezone: true }),
    /** Set when a hosted box hides the routine until an explicit automation sync deletes the shadow. */
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("routines_account_id_idx").on(t.accountId),
    index("routines_enabled_idx").on(t.enabled),
  ],
);

export const automationShadows = pgTable(
  "automation_shadows",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id),
    routineId: uuid("routine_id").notNull(),
    botId: uuid("bot_id").notNull(),
    skillId: uuid("skill_id").notNull(),
    name: text("name").notNull(),
    trigger: jsonb("trigger").$type<(typeof routines.$inferSelect)["trigger"]>().notNull(),
    enabled: boolean("enabled").notNull().default(true),
    onError: text("on_error").$type<"notify_user" | "retry" | "pause">().notNull().default("pause"),
    lastTriggeredAt: timestamp("last_triggered_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("automation_shadows_routine_idx").on(t.routineId),
    index("automation_shadows_account_idx").on(t.accountId),
  ],
);

export const routineRuns = pgTable(
  "routine_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    routineId: uuid("routine_id")
      .notNull()
      .references(() => routines.id),
    triggeredAt: timestamp("triggered_at", { withTimezone: true }).defaultNow().notNull(),
    status: text("status")
      .$type<"queued" | "running" | "settled" | "error">()
      .notNull()
      .default("queued"),
    durationMs: integer("duration_ms"),
    inputSummary: text("input_summary").notNull().default(""),
    outputSummary: text("output_summary").notNull().default(""),
    errorMessage: text("error_message"),
  },
  (t) => [index("routine_runs_routine_time_idx").on(t.routineId, t.triggeredAt)],
);

export const connectorAccounts = pgTable(
  "connector_accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id),
    service: text("service").notNull(),
    providerUserId: text("provider_user_id"),
    accessTokenCiphertext: text("access_token_ciphertext").notNull(),
    refreshTokenCiphertext: text("refresh_token_ciphertext"),
    scopes: jsonb("scopes").$type<string[]>().notNull().default([]),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("connector_accounts_account_service_uq").on(t.accountId, t.service),
    index("connector_accounts_account_idx").on(t.accountId),
  ],
);

export const apiKeys = pgTable(
  "api_keys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id),
    name: text("name").notNull(),
    keyHash: text("key_hash").notNull(),
    keyPrefix: text("key_prefix").notNull(),
    scopes: jsonb("scopes").$type<Array<"read-only" | "read-write" | "admin">>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("api_keys_hash_uq").on(t.keyHash),
    index("api_keys_account_idx").on(t.accountId),
  ],
);

export const mcpServers = pgTable(
  "mcp_servers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id),
    name: text("name").notNull(),
    url: text("url").notNull(),
    authTokenCiphertext: text("auth_token_ciphertext"),
    cachedTools: jsonb("cached_tools")
      .$type<
        Array<{ name: string; description?: string; inputSchema?: unknown; warning?: string }>
      >()
      .notNull()
      .default([]),
    lastHealth: text("last_health")
      .$type<"unknown" | "healthy" | "error">()
      .notNull()
      .default("unknown"),
    lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("mcp_servers_account_idx").on(t.accountId)],
);

export const webhookSubscriptions = pgTable(
  "webhook_subscriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id),
    url: text("url").notNull(),
    secretCiphertext: text("secret_ciphertext").notNull(),
    events: jsonb("events")
      .$type<Array<"turn.settled" | "routine.completed" | "approval.required">>()
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("webhook_subscriptions_account_idx").on(t.accountId)],
);

export const webhookDeliveries = pgTable(
  "webhook_deliveries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    eventId: uuid("event_id").notNull(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id),
    subscriptionId: uuid("subscription_id").notNull(),
    event: text("event")
      .$type<"turn.settled" | "routine.completed" | "approval.required">()
      .notNull(),
    url: text("url").notNull(),
    eventData: jsonb("event_data").$type<Record<string, unknown>>().notNull(),
    status: text("status")
      .$type<"queued" | "processing" | "delivered" | "failed" | "cancelled">()
      .notNull()
      .default("queued"),
    attemptCount: integer("attempt_count").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),
    leaseUntil: timestamp("lease_until", { withTimezone: true }),
    lastStatusCode: integer("last_status_code"),
    lastError: text("last_error"),
    responseSnippet: text("response_snippet"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
  },
  (t) => [
    index("webhook_deliveries_due_idx").on(t.status, t.nextAttemptAt),
    index("webhook_deliveries_account_created_idx").on(t.accountId, t.createdAt),
    index("webhook_deliveries_subscription_idx").on(t.subscriptionId),
  ],
);

export const subagents = pgTable(
  "subagents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id),
    parentBotId: uuid("parent_bot_id")
      .notNull()
      .references(() => bots.id),
    childBotId: uuid("child_bot_id")
      .notNull()
      .references(() => bots.id),
    parentTurnId: uuid("parent_turn_id")
      .notNull()
      .references(() => turns.id),
    childTurnId: uuid("child_turn_id")
      .notNull()
      .references(() => turns.id),
    childRunId: text("child_run_id").notNull(),
    completionTurnId: uuid("completion_turn_id").references(() => turns.id),
    completionRunId: text("completion_run_id"),
    taskDescription: text("task_description").notNull(),
    allowedTools: jsonb("allowed_tools").$type<string[]>().notNull(),
    status: text("status")
      .$type<"queued" | "running" | "completed" | "error" | "cancelled" | "stalled">()
      .notNull()
      .default("queued"),
    result: text("result").notNull().default(""),
    usage: jsonb("usage").$type<{
      promptTokens: number;
      completionTokens: number;
      totalTokens: number;
      source?: "provider" | "estimate";
    }>(),
    stallCount: integer("stall_count").notNull().default(0),
    lastProgressAt: timestamp("last_progress_at", { withTimezone: true }),
    stallEvents: jsonb("stall_events")
      .$type<Array<{ at: string; reason: string }>>()
      .notNull()
      .default([]),
    steeringEvents: jsonb("steering_events")
      .$type<Array<{ at: string; message: string }>>()
      .notNull()
      .default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [
    index("subagents_account_parent_idx").on(t.accountId, t.parentBotId),
    index("subagents_child_run_idx").on(t.childRunId),
  ],
);
