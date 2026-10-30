import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";

const api = new OpenAPIHono();
const ErrorBody = z.object({ error: z.string() });
const Ok = z.object({ ok: z.boolean() });
const Deleted = z.object({ deleted: z.boolean() });
const Bot = z.object({
  id: z.string(),
  accountId: z.string(),
  name: z.string(),
  role: z.enum(["main", "peer", "subagent"]),
  systemPrompt: z.string(),
  profileText: z.string(),
  tools: z.array(z.string()),
  skills: z.array(z.string()),
  inferenceSettings: z.object({
    providerId: z.string().optional(),
    model: z.string().optional(),
  }),
  localMachineAccess: z.enum(["never", "always_confirm", "always_allow"]),
  retainData: z.boolean(),
});
const CreateBot = z.object({
  name: z.string(),
  role: z.enum(["main", "peer"]).optional(),
  systemPrompt: z.string().optional(),
  profileText: z.string().optional(),
});
const UpdateBot = CreateBot.partial().extend({
  inferenceProvider: z.string().optional(),
  inferenceModel: z.string().optional(),
  retainData: z.boolean().optional(),
  localMachineAccess: z.enum(["never", "always_confirm", "always_allow"]).optional(),
});
const Memory = z.object({
  id: z.string(),
  scope: z.enum(["agent", "user", "project"]),
  content: z.string(),
  source: z.string(),
  staleAfter: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
const CreateMemory = z.object({
  scope: z.enum(["agent", "user", "project"]),
  content: z.string(),
  projectId: z.string().optional(),
});
const SkillStep = z.object({
  instruction: z.string(),
  approvalRequired: z.boolean().optional(),
  onError: z.enum(["stop", "retry", "skip", "notify_user", "custom_prompt"]).optional(),
  maxAttempts: z.number().optional(),
  customPrompt: z.string().optional(),
});
const Skill = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  steps: z.array(SkillStep),
  version: z.number(),
  ownerBotId: z.string().nullable(),
});
const CreateSkill = z.object({
  name: z.string(),
  description: z.string().optional(),
  ownerBotId: z.string().optional(),
  steps: z.array(SkillStep),
});
const RoutineTrigger = z.union([
  z.object({ type: z.literal("cron"), schedule: z.string() }),
  z.object({ type: z.literal("webhook") }),
  z.object({ type: z.literal("inter_bot_message"), senderBotId: z.string().optional() }),
  z.object({ type: z.literal("file_change"), path: z.string() }),
]);
const Routine = z.object({
  id: z.string(),
  botId: z.string(),
  skillId: z.string(),
  name: z.string(),
  enabled: z.boolean(),
  trigger: RoutineTrigger,
  onError: z.enum(["notify_user", "retry", "pause"]),
  lastTriggeredAt: z.string().nullable(),
  nextRunAt: z.string().nullable().optional(),
});
const CreateRoutine = z.object({
  botId: z.string(),
  skillId: z.string(),
  name: z.string(),
  trigger: RoutineTrigger,
  enabled: z.boolean().optional(),
  onError: z.enum(["notify_user", "retry", "pause"]).optional(),
});
const RoutineRun = z.object({
  id: z.string(),
  status: z.string(),
  triggeredAt: z.string(),
  durationMs: z.number().nullable(),
  inputSummary: z.string(),
  outputSummary: z.string(),
  errorMessage: z.string().nullable(),
});
const Connector = z.object({
  service: z.string(),
  scopes: z.array(z.string()),
  expiresAt: z.string().nullable(),
  connectedAt: z.string(),
});
const McpServer = z.object({
  id: z.string(),
  name: z.string(),
  url: z.string(),
  lastHealth: z.string(),
  lastCheckedAt: z.string().nullable(),
});
const AddMcp = z.object({
  name: z.string(),
  url: z.string(),
  apiKey: z.string().optional(),
});
const AuditEntry = z.object({
  id: z.string(),
  toolName: z.string(),
  outcome: z.string(),
  createdAt: z.string(),
});
const ApiKey = z.object({
  id: z.string(),
  name: z.string(),
  keyPrefix: z.string(),
  scopes: z.array(z.string()),
  createdAt: z.string(),
});
const CreateApiKey = z.object({
  name: z.string(),
  scope: z.enum(["read-only", "read-write", "admin"]),
});
const botId = z.object({ botId: z.string() });
const memoryId = z.object({ botId: z.string(), memoryId: z.string() });
const skillId = z.object({ skillId: z.string() });
const routineId = z.object({ routineId: z.string() });
const service = z.object({ service: z.string() });
const serverId = z.object({ serverId: z.string() });
const keyId = z.object({ keyId: z.string() });

function add(spec: {
  method: "get" | "post" | "patch" | "delete";
  path: string;
  summary: string;
  response: z.ZodType;
  status?: number;
  security?: Array<Record<string, string[]>>;
  params?: z.ZodType;
  body?: z.ZodType;
}) {
  const status = spec.status ?? 200;
  const route = createRoute({
    method: spec.method,
    path: spec.path,
    summary: spec.summary,
    security: spec.security ?? [{ bearerAuth: [] }],
    request: {
      ...(spec.params ? { params: spec.params } : {}),
      ...(spec.body
        ? { body: { content: { "application/json": { schema: spec.body } }, required: true } }
        : {}),
    },
    responses: {
      [status]: {
        description: spec.summary,
        content: { "application/json": { schema: spec.response } },
      },
      400: {
        description: "Invalid request",
        content: { "application/json": { schema: ErrorBody } },
      },
      401: {
        description: "Unauthorized",
        content: { "application/json": { schema: ErrorBody } },
      },
    },
  } as never);
  api.openapi(route, (() => new Response("{}", { status })) as never);
}

const publicRoute = [] as Array<Record<string, string[]>>;

add({
  method: "get",
  path: "/health",
  summary: "Liveness probe",
  response: Ok,
  security: publicRoute,
});
add({
  method: "get",
  path: "/ready",
  summary: "Readiness probe",
  response: Ok,
  security: publicRoute,
});
add({
  method: "get",
  path: "/v1/bots",
  summary: "List bots",
  response: z.array(Bot),
});
add({
  method: "post",
  path: "/v1/bots",
  summary: "Create a bot",
  body: CreateBot,
  response: Bot,
  status: 201,
});
add({
  method: "get",
  path: "/v1/bots/{botId}",
  summary: "Read a bot",
  params: botId,
  response: Bot,
});
add({
  method: "patch",
  path: "/v1/bots/{botId}",
  summary: "Update a bot",
  params: botId,
  body: UpdateBot,
  response: Bot,
});
add({
  method: "delete",
  path: "/v1/bots/{botId}",
  summary: "Delete a bot",
  params: botId,
  response: Deleted,
});
add({
  method: "get",
  path: "/v1/bots/{botId}/memory",
  summary: "List memories",
  params: botId,
  response: z.array(Memory),
});
add({
  method: "post",
  path: "/v1/bots/{botId}/memory",
  summary: "Create a memory",
  params: botId,
  body: CreateMemory,
  response: Memory,
  status: 201,
});
add({
  method: "get",
  path: "/v1/bots/{botId}/memory/export",
  summary: "Export memories",
  params: botId,
  response: z.object({ botId: z.string(), memories: z.array(Memory) }),
});
add({
  method: "patch",
  path: "/v1/bots/{botId}/memory/{memoryId}",
  summary: "Update a memory",
  params: memoryId,
  body: z.object({ content: z.string() }),
  response: Memory,
});
add({
  method: "delete",
  path: "/v1/bots/{botId}/memory/{memoryId}",
  summary: "Delete a memory",
  params: memoryId,
  response: Deleted,
});
add({ method: "get", path: "/v1/skills", summary: "List skills", response: z.array(Skill) });
add({
  method: "post",
  path: "/v1/skills",
  summary: "Create a skill",
  body: CreateSkill,
  response: Skill,
  status: 201,
});
add({
  method: "patch",
  path: "/v1/skills/{skillId}",
  summary: "Update a skill",
  params: skillId,
  body: CreateSkill.partial(),
  response: Skill,
});
add({
  method: "delete",
  path: "/v1/skills/{skillId}",
  summary: "Delete a skill",
  params: skillId,
  response: Deleted,
});
add({ method: "get", path: "/v1/routines", summary: "List routines", response: z.array(Routine) });
add({
  method: "post",
  path: "/v1/routines",
  summary: "Create a routine",
  body: CreateRoutine,
  response: z.object({ routine: Routine, webhookSecret: z.string().optional() }),
  status: 201,
});
add({
  method: "patch",
  path: "/v1/routines/{routineId}",
  summary: "Update a routine",
  params: routineId,
  body: CreateRoutine.partial(),
  response: z.object({ routine: Routine, webhookSecret: z.string().optional() }),
});
add({
  method: "delete",
  path: "/v1/routines/{routineId}",
  summary: "Delete a routine",
  params: routineId,
  response: Deleted,
});
add({
  method: "post",
  path: "/v1/routines/{routineId}/test",
  summary: "Queue a routine test run",
  params: routineId,
  response: z.object({ turnId: z.string(), runId: z.string(), routineRunId: z.string() }),
  status: 202,
});
add({
  method: "get",
  path: "/v1/routines/{routineId}/history",
  summary: "Read routine history",
  params: routineId,
  response: z.array(RoutineRun),
});
add({
  method: "get",
  path: "/v1/connectors",
  summary: "List connected services",
  response: z.array(Connector),
});
add({
  method: "delete",
  path: "/v1/connectors/{service}",
  summary: "Disconnect a service",
  params: service,
  response: z.object({
    disconnected: z.boolean(),
    providerRevocation: z.enum(["succeeded", "failed", "skipped"]),
  }),
});
add({
  method: "get",
  path: "/v1/connectors/oauth/start/{service}",
  summary: "Start an OAuth connection",
  params: service,
  response: z.object({}),
});
add({
  method: "get",
  path: "/v1/connectors/oauth/callback",
  summary: "Complete an OAuth callback",
  response: z.object({}),
  security: publicRoute,
});
add({
  method: "get",
  path: "/v1/connectors/mcp",
  summary: "List MCP servers",
  response: z.array(McpServer),
});
add({
  method: "post",
  path: "/v1/connectors/mcp",
  summary: "Add an MCP server",
  body: AddMcp,
  response: McpServer,
  status: 201,
});
add({
  method: "delete",
  path: "/v1/connectors/mcp/{serverId}",
  summary: "Remove an MCP server",
  params: serverId,
  response: Deleted,
});
add({
  method: "get",
  path: "/v1/audit-log",
  summary: "Read the audit log",
  response: z.array(AuditEntry),
});
add({ method: "get", path: "/v1/api-keys", summary: "List API keys", response: z.array(ApiKey) });
add({
  method: "post",
  path: "/v1/api-keys",
  summary: "Create an API key",
  body: CreateApiKey,
  response: ApiKey.extend({ key: z.string() }),
  status: 201,
});
add({
  method: "delete",
  path: "/v1/api-keys/{keyId}",
  summary: "Revoke an API key",
  params: keyId,
  response: z.object({ revoked: z.boolean() }),
});
add({
  method: "post",
  path: "/v1/webhooks/{routineId}",
  summary: "Trigger a webhook routine",
  params: routineId,
  response: z.object({ turnId: z.string(), runId: z.string(), routineRunId: z.string() }),
  status: 202,
  security: publicRoute,
});
add({
  method: "post",
  path: "/v1/auth/bootstrap",
  summary: "Create the first account and bearer token",
  body: z.object({ email: z.string(), displayName: z.string().optional() }),
  response: z.object({ accountId: z.string(), token: z.string(), expiresInSeconds: z.number() }),
  status: 201,
  security: publicRoute,
});
add({
  method: "post",
  path: "/v1/auth/session",
  summary: "Mint a replacement JWT",
  response: z.object({ token: z.string(), scopes: z.array(z.string()) }),
});
add({
  method: "post",
  path: "/v1/auth/sessions/revoke",
  summary: "Revoke current JWT sessions",
  response: z.object({ revoked: z.boolean(), sessionVersion: z.number() }),
});
add({
  method: "get",
  path: "/v1/inference/providers",
  summary: "List inference providers",
  response: z.object({ providers: z.array(z.object({ id: z.string() })) }),
});
add({
  method: "get",
  path: "/v1/subagents",
  summary: "List subagents",
  response: z.array(z.object({ id: z.string(), status: z.string(), taskDescription: z.string() })),
});
add({
  method: "get",
  path: "/v1/subagents/{subagentId}",
  summary: "Read a subagent",
  params: z.object({ subagentId: z.string() }),
  response: z.object({ id: z.string(), status: z.string() }),
});
add({
  method: "get",
  path: "/v1/webhook-subscriptions",
  summary: "List outbound webhook subscriptions",
  response: z.array(z.object({ id: z.string(), url: z.string() })),
});
add({
  method: "post",
  path: "/v1/webhook-subscriptions",
  summary: "Create an outbound webhook subscription",
  body: z.object({ url: z.string(), events: z.array(z.string()) }),
  response: z.object({ id: z.string(), secret: z.string() }),
  status: 201,
});
add({
  method: "delete",
  path: "/v1/webhook-subscriptions/{subscriptionId}",
  summary: "Delete an outbound webhook subscription",
  params: z.object({ subscriptionId: z.string() }),
  response: Deleted,
});
add({
  method: "get",
  path: "/v1/webhook-deliveries",
  summary: "List outbound webhook deliveries",
  response: z.array(z.object({ id: z.string(), status: z.string() })),
});
add({
  method: "post",
  path: "/v1/webhook-deliveries/{deliveryId}/retry",
  summary: "Retry a webhook delivery",
  params: z.object({ deliveryId: z.string() }),
  response: z.object({ requeued: z.boolean(), id: z.string() }),
});
add({
  method: "post",
  path: "/v1/connectors/rotate-encryption-key",
  summary: "Re-encrypt connector secrets with the current key",
  response: z.object({ rotated: z.number(), complete: z.boolean() }),
});
add({
  method: "post",
  path: "/v1/skills/{skillId}/assign",
  summary: "Copy a skill onto a bot",
  params: skillId,
  body: z.object({ botId: z.string() }),
  response: Skill,
  status: 201,
});
add({
  method: "get",
  path: "/v1/skills/{skillId}/versions",
  summary: "List skill versions",
  params: skillId,
  response: z.array(z.object({ version: z.number() })),
});
add({
  method: "post",
  path: "/v1/skills/{skillId}/test",
  summary: "Queue a skill test",
  params: skillId,
  body: z.object({ botId: z.string() }),
  response: z.object({ runId: z.string(), status: z.string() }),
  status: 202,
});
add({
  method: "get",
  path: "/metrics",
  summary: "Prometheus metrics",
  response: z.string(),
  security: publicRoute,
});

export function openApiDocument() {
  const document = api.getOpenAPI31Document({
    openapi: "3.1.0",
    info: {
      title: "AgentOS API",
      version: "0.1.0",
      description:
        "Bearer authentication applies to /v1 routes except bootstrap, the OAuth callback, and routine webhooks.",
    },
  });
  return {
    ...document,
    components: {
      ...document.components,
      securitySchemes: {
        bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
      },
    },
  };
}
