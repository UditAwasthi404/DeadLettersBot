import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";

const api = new OpenAPIHono();
const ErrorBody = z.object({ error: z.string() });
const Ok = z.object({ ok: z.boolean() });
const Deleted = z.object({ deleted: z.boolean() });
const LocalMachineAccess = z.enum(["never", "always_confirm", "always_allow"]);
const PermissionLevel = z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]);
const MemorySettings = z.object({
  agentScope: z.boolean(),
  userScope: z.boolean(),
  projectScope: z.boolean(),
  projectId: z.string().optional(),
});
const ApprovalSettings = z.object({
  autoReviewRules: z.array(
    z.object({ actionPattern: z.string(), mode: z.enum(["require", "always_allow"]) }),
  ),
  defaultLevel: PermissionLevel,
});
const InferenceSettings = z.object({
  providerId: z.string().optional(),
  model: z.string().optional(),
});
const Bot = z.object({
  id: z.string(),
  accountId: z.string(),
  name: z.string(),
  role: z.enum(["main", "peer", "subagent"]),
  systemPrompt: z.string(),
  profileText: z.string(),
  tools: z.array(z.string()),
  skills: z.array(z.string()),
  inferenceSettings: InferenceSettings,
  memorySettings: MemorySettings,
  approvalSettings: ApprovalSettings,
  localMachineAccess: LocalMachineAccess,
  retainData: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
const ChatHistoryItem = z.object({
  id: z.string(),
  runId: z.string(),
  agentId: z.string(),
  role: z.enum(["user", "assistant"]),
  content: z.string(),
});
const Attachment = z.object({
  id: z.string(),
  name: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number(),
  uri: z.string(),
});
const CreateBot = z.object({
  name: z.string(),
  role: z.enum(["main", "peer"]).optional(),
  systemPrompt: z.string().optional(),
  profileText: z.string().optional(),
  tools: z.array(z.string()).optional(),
});
const UpdateBot = CreateBot.partial().extend({
  role: z.enum(["main", "peer"]).optional(),
  skills: z.array(z.string()).optional(),
  memorySettings: MemorySettings.optional(),
  approvalSettings: ApprovalSettings.optional(),
  inferenceSettings: InferenceSettings.optional(),
  inferenceProvider: z.string().optional(),
  inferenceModel: z.string().optional(),
  retainData: z.boolean().optional(),
  localMachineAccess: LocalMachineAccess.optional(),
  tools: z
    .union([z.array(z.string()), z.object({ localMachineAccess: LocalMachineAccess })])
    .optional(),
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
const SkillStep = z
  .object({
    instruction: z.string().trim().min(1).max(4000),
    approvalRequired: z.boolean().optional(),
    onError: z.enum(["stop", "retry", "skip", "notify_user", "custom_prompt"]).optional(),
    maxAttempts: z.number().int().min(1).max(10).optional(),
    customPrompt: z.string().max(2000).optional(),
  })
  .refine((step) => step.onError !== "custom_prompt" || Boolean(step.customPrompt?.trim()), {
    message: "customPrompt is required when onError is custom_prompt",
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
  name: z.string().trim().min(1).max(120),
  description: z.string().max(2000).optional(),
  ownerBotId: z.string().optional(),
  steps: z.array(SkillStep).min(1).max(50),
});
const RoutineTrigger = z.union([
  z.object({ type: z.literal("cron"), schedule: z.string() }),
  z.object({ type: z.literal("webhook") }),
  z.object({ type: z.literal("inter_bot_message"), senderBotId: z.string().optional() }),
  z.object({ type: z.literal("file_change"), path: z.string() }),
  z.object({
    type: z.literal("connector_event"),
    service: z.enum(["gmail", "google-calendar"]),
    sender: z.string().optional(),
    subject: z.string().optional(),
    query: z.string().optional(),
    calendarId: z.string().optional(),
  }),
]);
const Routine = z.object({
  id: z.string(),
  accountId: z.string(),
  botId: z.string(),
  skillId: z.string(),
  name: z.string(),
  enabled: z.boolean(),
  trigger: RoutineTrigger,
  onError: z.enum(["notify_user", "retry", "pause"]),
  lastTriggeredAt: z.string().nullable(),
  nextRunAt: z.string().nullable().optional(),
  cronTimezone: z.string().nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
const CreateRoutine = z.object({
  botId: z.string(),
  skillId: z.string(),
  name: z.string().trim().min(1).max(120),
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
  lastError: z.string().nullable(),
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
  lastUsedAt: z.string().nullable().optional(),
  revokedAt: z.string().nullable().optional(),
});
const CreateApiKey = z.object({
  name: z.string(),
  scope: z.enum(["read-only", "read-write", "admin"]),
});
const botId = z.object({ botId: z.string() });
const memoryId = z.object({ botId: z.string(), memoryId: z.string() });
const memoryReviewId = z.object({ botId: z.string(), reviewId: z.string() });
const skillId = z.object({ skillId: z.string() });
const routineId = z.object({ routineId: z.string() });
const service = z.object({ service: z.string() });
const serverId = z.object({ serverId: z.string() });
const keyId = z.object({ keyId: z.string() });

type ApiRouteSpec = {
  method: "get" | "post" | "patch" | "delete";
  path: string;
  summary: string;
  response: z.ZodType;
  status?: number;
  security?: Array<Record<string, string[]>>;
  params?: z.ZodType;
  query?: z.ZodType;
  body?: z.ZodType;
};

const apiRouteSpecs: ApiRouteSpec[] = [];

function routeOperationId(method: ApiRouteSpec["method"], path: string): string {
  const segments = path
    .split("/")
    .filter(Boolean)
    .map((segment) => {
      if (segment.startsWith("{") && segment.endsWith("}")) {
        const parameter = segment.slice(1, -1);
        return `By${parameter.charAt(0).toUpperCase()}${parameter.slice(1)}`;
      }
      return segment.replace(/-([a-z0-9])/g, (_match, letter: string) => letter.toUpperCase());
    });
  return `${method}${segments.map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1)).join("")}`;
}

function add(spec: ApiRouteSpec) {
  apiRouteSpecs.push(spec);
  const status = spec.status ?? 200;
  const route = createRoute({
    method: spec.method,
    path: spec.path,
    operationId: routeOperationId(spec.method, spec.path),
    summary: spec.summary,
    security: spec.security ?? [{ bearerAuth: [] }],
    request: {
      ...(spec.params ? { params: spec.params } : {}),
      ...(spec.query ? { query: spec.query } : {}),
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
      default: {
        description: "Request failed",
        content: { "application/json": { schema: ErrorBody } },
      },
    },
  } as never);
  api.openapi(route, (() => new Response("{}", { status })) as never);
}

function routeMatch(routeTemplate: string, path: string): Map<string, string> | null {
  const names: string[] = [];
  const source = routeTemplate
    .split("/")
    .map((segment) => {
      const parameter = /^\{([^}]+)\}$/.exec(segment);
      if (parameter?.[1]) {
        names.push(parameter[1]);
        return "([^/]+)";
      }
      return segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    })
    .join("/");
  const match = new RegExp(`^${source}/?$`).exec(path);
  if (!match) return null;
  return new Map(names.map((name, index) => [name, match[index + 1] ?? ""]));
}

function findApiRoute(method: string, path: string): ApiRouteSpec | undefined {
  return apiRouteSpecs.find(
    (candidate) =>
      candidate.method.toUpperCase() === method.toUpperCase() && routeMatch(candidate.path, path),
  );
}

export function openApiRequestBodyRequired(method: string, path: string): boolean {
  return Boolean(findApiRoute(method, path)?.body);
}

/** Validate documented success responses without exposing payload details to API clients. */
export function validateOpenApiResponse(
  method: string,
  path: string,
  status: number,
  body: unknown,
): { matched: boolean; error?: string } {
  const route = findApiRoute(method, path);
  if (!route) return { matched: false };
  const schema =
    status >= 400 ? ErrorBody : status === (route.status ?? 200) ? route.response : null;
  if (!schema) return { matched: false };
  const result = schema.safeParse(body);
  if (result.success) return { matched: true };
  const issues = result.error.issues.slice(0, 8).map((issue) => {
    const field = issue.path.map(String).join(".");
    return field ? `${field}: ${issue.message}` : issue.message;
  });
  return { matched: true, error: issues.join("; ") };
}

/** Validate documented request parameters and bodies before gateway dispatch. */
export function validateOpenApiRequest(
  method: string,
  path: string,
  body: unknown,
  query: URLSearchParams,
): { matched: boolean; error?: string } {
  const route = findApiRoute(method, path);
  if (!route) return { matched: false };
  const parameters = routeMatch(route.path, path);
  if (!parameters) return { matched: false };
  if (route.params) {
    const parsedParams = route.params.safeParse(Object.fromEntries(parameters));
    if (!parsedParams.success) return { matched: true, error: "path parameters are invalid" };
  }
  if (route.query) {
    const queryValues: Record<string, string> = {};
    for (const key of new Set(query.keys())) {
      const values = query.getAll(key);
      if (values.length > 1)
        return { matched: true, error: `query.${key} must be provided only once` };
      const value = values[0];
      if (value !== undefined) queryValues[key] = value;
    }
    const parsedQuery = route.query.safeParse(queryValues);
    if (!parsedQuery.success) {
      const issue = parsedQuery.error.issues[0];
      const field = issue?.path.map(String).join(".");
      return {
        matched: true,
        error: field
          ? `query.${field} ${issue?.message ?? "is invalid"}`
          : (issue?.message ?? "query parameters are invalid"),
      };
    }
  }
  if (route.body) {
    const parsedBody = route.body.safeParse(body);
    if (!parsedBody.success) {
      const issue = parsedBody.error.issues[0];
      const field = issue?.path.map(String).join(".");
      return {
        matched: true,
        error: field
          ? `${field} ${issue?.message ?? "is invalid"}`
          : (issue?.message ?? "body is invalid"),
      };
    }
  }
  return { matched: true };
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
  method: "get",
  path: "/v1/bots/{botId}/history",
  summary: "Read recent chat history",
  params: botId,
  response: z.object({ items: z.array(ChatHistoryItem) }),
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
  method: "post",
  path: "/v1/bots/{botId}/attachments",
  summary: "Store an attachment for a bot conversation",
  params: botId,
  body: z.object({ name: z.string(), mimeType: z.string().optional(), dataBase64: z.string() }),
  response: Attachment,
  status: 201,
});
add({
  method: "post",
  path: "/v1/bots/{botId}/browser-recording/start",
  summary: "Start recording browser actions for a bot",
  params: botId,
  response: z.object({ recording: z.boolean() }),
});
add({
  method: "post",
  path: "/v1/bots/{botId}/browser-recording/stop",
  summary: "Stop recording browser actions for a bot",
  params: botId,
  response: z.object({ events: z.array(z.unknown()) }),
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
  method: "get",
  path: "/v1/bots/{botId}/memory/{memoryId}/evidence",
  summary: "List source turns supporting a memory",
  params: memoryId,
  response: z.array(z.object({ id: z.string(), turnId: z.string(), createdAt: z.string() })),
});
add({
  method: "get",
  path: "/v1/bots/{botId}/memory/reviews",
  summary: "List pending memory update or deletion suggestions",
  params: botId,
  response: z.array(
    z.object({
      id: z.string(),
      memoryId: z.string(),
      turnId: z.string(),
      action: z.enum(["update", "delete"]),
      existingContent: z.string(),
      proposedContent: z.string().nullable(),
      reason: z.string().nullable(),
      createdAt: z.string(),
    }),
  ),
});
add({
  method: "post",
  path: "/v1/bots/{botId}/memory/reviews/{reviewId}",
  summary: "Accept or reject a memory change suggestion",
  params: memoryReviewId,
  body: z.object({ action: z.enum(["accept", "reject"]) }),
  response: z.object({ resolved: z.boolean(), action: z.enum(["accept", "reject"]) }),
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
  method: "post",
  path: "/v1/skills/draft",
  summary: "Draft a skill from browser recording events",
  body: z.object({ events: z.array(z.unknown()).min(1).max(2000) }),
  response: z.object({ name: z.string(), description: z.string(), steps: z.array(SkillStep) }),
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
  path: "/v1/automation/sync",
  summary: "Delete hosted schedules whose local routines were removed",
  response: z.object({ upserted: z.number(), deleted: z.number() }),
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
  query: z
    .object({
      state: z.string().optional(),
      code: z.string().optional(),
      error: z.string().optional(),
      error_description: z.string().optional(),
    })
    .passthrough(),
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
  query: z.object({
    limit: z.string().regex(/^\d+$/).optional(),
    offset: z.string().regex(/^\d+$/).optional(),
  }),
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
  response: z.object({
    accountId: z.string(),
    token: z.string().optional(),
    scopes: z.array(z.string()),
    provider: z.string().optional(),
    expiresInSeconds: z.number().nullable().optional(),
  }),
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
  method: "post",
  path: "/v1/subagents/{subagentId}/cancel",
  summary: "Request cancellation of a subagent task",
  params: z.object({ subagentId: z.string() }),
  response: z.object({ subagentId: z.string(), status: z.string() }),
  status: 202,
});
add({
  method: "post",
  path: "/v1/subagents/{subagentId}/steer",
  summary: "Add guidance to a running subagent task",
  params: z.object({ subagentId: z.string() }),
  body: z.object({ message: z.string().min(1).max(2000) }),
  response: z.object({ subagentId: z.string(), status: z.string(), steered: z.boolean() }),
  status: 202,
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
  query: z.object({ limit: z.string().regex(/^\d+$/).optional() }),
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
  response: Skill.extend({ copiedFromSkillId: z.string() }),
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
  path: "/v1/skills/{skillId}/test/{runId}",
  summary: "Get the status of a skill test",
  params: z.object({ skillId: z.string(), runId: z.string() }),
  response: z.object({ runId: z.string(), turnId: z.string(), status: z.string() }),
});
add({
  method: "post",
  path: "/v1/skills/{skillId}/rollback/{version}",
  summary: "Restore a previous skill version",
  params: z.object({ skillId: z.string(), version: z.string() }),
  response: Skill,
});
add({
  method: "get",
  path: "/metrics",
  summary: "Prometheus metrics",
  response: z.string(),
  security: publicRoute,
});

export function openApiDocument(): Record<string, unknown> {
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
