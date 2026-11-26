export type {
  operations as AgentOSApiOperations,
  paths as AgentOSApiPaths,
} from "./openapi.generated.js";

import type { operations as ApiOperations } from "./openapi.generated.js";

type OperationResponses<Operation> = Operation extends { responses: infer Responses }
  ? Responses
  : never;
type JsonBody<Content> = Content extends { "application/json": infer Body } ? Body : never;
type OperationRequest<Operation> = Operation extends {
  requestBody: { content: infer Content };
}
  ? JsonBody<Content>
  : never;
type OperationResponse<
  Operation,
  Status extends keyof OperationResponses<Operation>,
> = OperationResponses<Operation>[Status] extends { content: infer Content }
  ? JsonBody<Content>
  : never;

/** Operation IDs and bodies generated from the host's OpenAPI contract. */
export type AgentOSApiOperationId = keyof ApiOperations;
export type AgentOSApiRequestBody<OperationId extends AgentOSApiOperationId> = OperationRequest<
  ApiOperations[OperationId]
>;
export type AgentOSApiResponseBody<
  OperationId extends AgentOSApiOperationId,
  Status extends keyof OperationResponses<ApiOperations[OperationId]>,
> = OperationResponse<ApiOperations[OperationId], Status>;

export type BotRecord = AgentOSApiResponseBody<"postV1Bots", 201>;
export type BotSummary = Pick<BotRecord, "id" | "name" | "role">;
export interface ChatHistoryItem {
  id: string;
  runId: string;
  agentId: string;
  role: "user" | "assistant";
  content: string;
}
export interface BotAttachmentRecord {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  uri: string;
}
export interface MemoryRecord {
  id: string;
  accountId: string;
  botId: string | null;
  projectId: string | null;
  scope: "agent" | "user" | "project";
  content: string;
  source: string;
  sourceTurnId: string | null;
  isUserAuthored: boolean;
  staleAfter: string | null;
  createdAt: string;
  updatedAt: string;
}
export interface MemoryEvidenceRecord {
  id: string;
  turnId: string;
  createdAt: string;
}
export interface MemoryReviewSuggestion {
  id: string;
  memoryId: string;
  turnId: string;
  existingContent: string;
  proposedContent: string;
  createdAt: string;
}
export interface SkillStep {
  instruction: string;
  approvalRequired?: boolean;
  onError?: "stop" | "retry" | "skip" | "notify_user" | "custom_prompt";
  /** Maximum failed tool actions before the runtime stops this step; defaults to 3. */
  maxAttempts?: number;
  /** User-authored recovery guidance for the next model attempt after a tool fails. */
  customPrompt?: string;
}
export interface SkillRecord {
  id: string;
  accountId: string;
  ownerBotId: string | null;
  name: string;
  description: string;
  steps: SkillStep[];
  version: number;
  createdAt: string;
  updatedAt: string;
}
export type RoutineTrigger =
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
    };
export interface RoutineRecord {
  id: string;
  accountId: string;
  botId: string;
  skillId: string;
  name: string;
  trigger: RoutineTrigger;
  enabled: boolean;
  onError: "notify_user" | "retry" | "pause";
  lastTriggeredAt: string | null;
  createdAt: string;
  updatedAt: string;
  nextRunAt?: string | null;
  cronTimezone?: string | null;
}
export interface RoutineRunRecord {
  id: string;
  routineId: string;
  triggeredAt: string;
  status: "queued" | "running" | "settled" | "error";
  durationMs: number | null;
  inputSummary: string;
  outputSummary: string;
  errorMessage: string | null;
}
export interface ApiKeyRecord {
  id: string;
  name: string;
  keyPrefix: string;
  scopes: Array<"read-only" | "read-write" | "admin">;
  createdAt: string;
  lastUsedAt?: string | null;
  revokedAt?: string | null;
}
export interface WebhookSubscription {
  id: string;
  url: string;
  events: Array<"turn.settled" | "routine.completed" | "approval.required">;
  createdAt: string;
  lastUsedAt?: string | null;
  revokedAt?: string | null;
}
export interface WebhookDeliveryRecord {
  id: string;
  eventId: string;
  subscriptionId: string;
  event: WebhookSubscription["events"][number];
  status: "queued" | "processing" | "delivered" | "failed" | "cancelled";
  attemptCount: number;
  nextAttemptAt: string | null;
  lastStatusCode: number | null;
  lastError: string | null;
  responseSnippet: string | null;
  createdAt: string;
  updatedAt: string;
  deliveredAt: string | null;
}
export interface ConnectorRecord {
  service: string;
  scopes: string[];
  expiresAt: string | null;
  connectedAt: string;
}
export interface McpServerRecord {
  id: string;
  name: string;
  url: string;
  cachedTools: Array<{
    name: string;
    description?: string;
    inputSchema?: unknown;
    warning?: string;
  }>;
  lastHealth: string;
  lastError: string | null;
  lastCheckedAt: string | null;
  createdAt?: string;
}
export interface SubagentRecord {
  id: string;
  parentBotId: string;
  taskDescription: string;
  allowedTools: string[];
  status: "queued" | "running" | "completed" | "error" | "cancelled" | "stalled";
  result: string | null;
  usage: { promptTokens: number; completionTokens: number; totalTokens: number } | null;
  stallCount?: number;
  lastProgressAt?: string | null;
  stallEvents?: Array<{ at: string; reason: string }>;
  steeringEvents?: Array<{ at: string; message: string }>;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
}
export interface AuditLogRecord {
  id: string;
  accountId: string;
  botId: string | null;
  turnId: string | null;
  toolName: string;
  paramsHash: string;
  machineId: string | null;
  approvalStatus: "not_required" | "pending" | "allow_once" | "deny" | "always_allow" | null;
  outcome: "success" | "error" | "denied" | "cancelled";
  errorMessage: string | null;
  createdAt: string;
  retained: boolean;
}
export interface AgentOSClientOptions {
  baseUrl: string;
  token: string;
  fetch?: typeof fetch;
}
export interface BootstrapResult {
  accountId: string;
  token: string;
  expiresInSeconds: number;
}
export type ApiKeyScope = "read-only" | "read-write" | "admin";
export type SessionResult =
  | (BootstrapResult & { scopes: ApiKeyScope[] })
  | {
      accountId: string;
      scopes: ApiKeyScope[];
      provider: string;
      expiresInSeconds: number | null;
    };
export interface GatewayFrame {
  type: string;
  [key: string]: unknown;
}
export interface GatewaySocket {
  send(data: string): void;
  close(): void;
}
export type GatewaySocketFactory = (url: string, bearerToken: string) => GatewaySocket;

export class AgentOSError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly payload?: unknown,
  ) {
    super(message);
    this.name = "AgentOSError";
  }
}

/** Typed JSON API and WebSocket client for an AgentOS account. */
export class AgentOSClient {
  private readonly options: AgentOSClientOptions;
  private readonly baseUrl: URL;
  private readonly fetchImpl: typeof fetch;

  constructor(baseUrlOrOptions: string | AgentOSClientOptions, token?: string) {
    const options =
      typeof baseUrlOrOptions === "string"
        ? { baseUrl: baseUrlOrOptions, token: token ?? "" }
        : baseUrlOrOptions;
    if (!options.token) throw new Error("token is required");
    this.options = options;
    this.baseUrl = new URL(options.baseUrl);
    if (this.baseUrl.protocol !== "http:" && this.baseUrl.protocol !== "https:")
      throw new Error("baseUrl must use HTTP or HTTPS");
    this.fetchImpl = options.fetch ?? fetch;
  }

  async request<T>(
    path: string,
    init: { method?: string; body?: unknown; signal?: AbortSignal } = {},
  ): Promise<T> {
    if (!path.startsWith("/v1/") || path.startsWith("//"))
      throw new Error("path must be an AgentOS /v1 route");
    const response = await this.fetchImpl(new URL(path, this.baseUrl), {
      method: init.method ?? "GET",
      signal: init.signal,
      headers: {
        Authorization: `Bearer ${this.options.token}`,
        ...(init.body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
    return this.readResponse<T>(response);
  }

  private async readResponse<T>(response: Response): Promise<T> {
    const text = await response.text();
    let payload: unknown;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      payload = text;
    }
    if (!response.ok) {
      const message =
        typeof payload === "object" && payload !== null && "error" in payload
          ? String(payload.error)
          : `AgentOS request failed (${response.status})`;
      throw new AgentOSError(message, response.status, payload);
    }
    return payload as T;
  }

  async bootstrap(input: { email: string; displayName?: string }): Promise<BootstrapResult> {
    const response = await this.fetchImpl(new URL("/v1/auth/bootstrap", this.baseUrl), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    return this.readResponse(response);
  }

  createSession(): Promise<SessionResult> {
    return this.request("/v1/auth/session", { method: "POST" });
  }

  revokeSessions(): Promise<{ revoked: true; sessionVersion: number }> {
    return this.request("/v1/auth/sessions/revoke", { method: "POST" });
  }

  listBots(signal?: AbortSignal): Promise<BotSummary[]> {
    return this.request("/v1/bots", { signal });
  }

  listInferenceProviders(): Promise<{ providers: Array<{ id: string }> }> {
    return this.request("/v1/inference/providers");
  }

  getBot(botId: string): Promise<AgentOSApiResponseBody<"getV1BotsByBotId", 200>> {
    return this.request(`/v1/bots/${encodeURIComponent(botId)}`);
  }

  getBotHistory(botId: string): Promise<{ items: ChatHistoryItem[] }> {
    return this.request(`/v1/bots/${encodeURIComponent(botId)}/history`);
  }

  uploadAttachment(
    botId: string,
    input: { name: string; mimeType?: string; dataBase64: string },
  ): Promise<BotAttachmentRecord> {
    return this.request(`/v1/bots/${encodeURIComponent(botId)}/attachments`, {
      method: "POST",
      body: input,
    });
  }

  createBot(
    input: AgentOSApiRequestBody<"postV1Bots">,
  ): Promise<AgentOSApiResponseBody<"postV1Bots", 201>> {
    return this.request("/v1/bots", { method: "POST", body: input });
  }

  updateBot(
    botId: string,
    input: AgentOSApiRequestBody<"patchV1BotsByBotId">,
  ): Promise<AgentOSApiResponseBody<"patchV1BotsByBotId", 200>> {
    return this.request(`/v1/bots/${encodeURIComponent(botId)}`, { method: "PATCH", body: input });
  }

  deleteBot(botId: string): Promise<{ deleted: true }> {
    return this.request(`/v1/bots/${encodeURIComponent(botId)}`, { method: "DELETE" });
  }

  listMemory(botId: string): Promise<MemoryRecord[]> {
    return this.request(`/v1/bots/${encodeURIComponent(botId)}/memory`);
  }

  exportMemory(botId: string): Promise<{ botId: string; memories: MemoryRecord[] }> {
    return this.request(`/v1/bots/${encodeURIComponent(botId)}/memory/export`);
  }

  listMemoryEvidence(botId: string, memoryId: string): Promise<MemoryEvidenceRecord[]> {
    return this.request(
      `/v1/bots/${encodeURIComponent(botId)}/memory/${encodeURIComponent(memoryId)}/evidence`,
    );
  }

  listMemoryReviewSuggestions(botId: string): Promise<MemoryReviewSuggestion[]> {
    return this.request(`/v1/bots/${encodeURIComponent(botId)}/memory/reviews`);
  }

  resolveMemoryReview(
    botId: string,
    reviewId: string,
    action: "accept" | "reject",
  ): Promise<{ resolved: true; action: "accept" | "reject" }> {
    return this.request(
      `/v1/bots/${encodeURIComponent(botId)}/memory/reviews/${encodeURIComponent(reviewId)}`,
      { method: "POST", body: { action } },
    );
  }

  createMemory(
    botId: string,
    input: { scope: "agent" | "user" | "project"; content: string; projectId?: string },
  ): Promise<MemoryRecord> {
    return this.request(`/v1/bots/${encodeURIComponent(botId)}/memory`, {
      method: "POST",
      body: input,
    });
  }

  updateMemory(botId: string, memoryId: string, content: string): Promise<MemoryRecord> {
    return this.request(
      `/v1/bots/${encodeURIComponent(botId)}/memory/${encodeURIComponent(memoryId)}`,
      { method: "PATCH", body: { content } },
    );
  }

  deleteMemory(botId: string, memoryId: string): Promise<{ deleted: true }> {
    return this.request(
      `/v1/bots/${encodeURIComponent(botId)}/memory/${encodeURIComponent(memoryId)}`,
      { method: "DELETE" },
    );
  }

  listSkills(): Promise<SkillRecord[]> {
    return this.request("/v1/skills");
  }
  createSkill(input: {
    name: string;
    description?: string;
    ownerBotId?: string;
    steps: SkillStep[];
  }): Promise<SkillRecord> {
    return this.request("/v1/skills", { method: "POST", body: input });
  }

  draftSkill(events: unknown[]): Promise<{
    name: string;
    description: string;
    steps: SkillStep[];
  }> {
    return this.request("/v1/skills/draft", { method: "POST", body: { events } });
  }

  startBrowserRecording(botId: string): Promise<{ recording: true }> {
    return this.request(`/v1/bots/${encodeURIComponent(botId)}/browser-recording/start`, {
      method: "POST",
    });
  }

  stopBrowserRecording(botId: string): Promise<{ events: unknown[] }> {
    return this.request(`/v1/bots/${encodeURIComponent(botId)}/browser-recording/stop`, {
      method: "POST",
    });
  }

  testSkill(
    skillId: string,
    botId: string,
  ): Promise<{ runId: string; turnId: string; status: string }> {
    return this.request(`/v1/skills/${encodeURIComponent(skillId)}/test`, {
      method: "POST",
      body: { botId },
    });
  }

  getSkillTest(
    skillId: string,
    runId: string,
  ): Promise<{ runId: string; turnId: string; status: string }> {
    return this.request(
      `/v1/skills/${encodeURIComponent(skillId)}/test/${encodeURIComponent(runId)}`,
    );
  }

  assignSkill(
    skillId: string,
    botId: string,
  ): Promise<SkillRecord & { copiedFromSkillId: string }> {
    return this.request(`/v1/skills/${encodeURIComponent(skillId)}/assign`, {
      method: "POST",
      body: { botId },
    });
  }

  updateSkill(
    skillId: string,
    input: Partial<Pick<SkillRecord, "name" | "description" | "steps">>,
  ): Promise<SkillRecord> {
    return this.request(`/v1/skills/${encodeURIComponent(skillId)}`, {
      method: "PATCH",
      body: input,
    });
  }

  listSkillVersions(skillId: string): Promise<unknown[]> {
    return this.request(`/v1/skills/${encodeURIComponent(skillId)}/versions`);
  }

  rollbackSkill(skillId: string, version: number): Promise<SkillRecord> {
    return this.request(
      `/v1/skills/${encodeURIComponent(skillId)}/rollback/${encodeURIComponent(String(version))}`,
      { method: "POST" },
    );
  }

  deleteSkill(skillId: string): Promise<{ deleted: true }> {
    return this.request(`/v1/skills/${encodeURIComponent(skillId)}`, { method: "DELETE" });
  }

  listRoutines(): Promise<RoutineRecord[]> {
    return this.request("/v1/routines");
  }

  createRoutine(input: {
    botId: string;
    skillId: string;
    name: string;
    trigger: RoutineTrigger;
    enabled?: boolean;
    onError?: RoutineRecord["onError"];
  }): Promise<{ routine: RoutineRecord; webhookSecret?: string }> {
    return this.request("/v1/routines", { method: "POST", body: input });
  }

  updateRoutine(
    routineId: string,
    input: Partial<
      Pick<RoutineRecord, "name" | "botId" | "skillId" | "enabled" | "onError" | "trigger">
    >,
  ): Promise<{ routine: RoutineRecord; webhookSecret?: string }> {
    return this.request(`/v1/routines/${encodeURIComponent(routineId)}`, {
      method: "PATCH",
      body: input,
    });
  }

  deleteRoutine(routineId: string): Promise<{ deleted: true }> {
    return this.request(`/v1/routines/${encodeURIComponent(routineId)}`, { method: "DELETE" });
  }

  runRoutine(routineId: string): Promise<{ turnId: string; runId: string; routineRunId: string }> {
    return this.request(`/v1/routines/${encodeURIComponent(routineId)}/test`, { method: "POST" });
  }

  getRoutineHistory(routineId: string): Promise<RoutineRunRecord[]> {
    return this.request(`/v1/routines/${encodeURIComponent(routineId)}/history`);
  }

  syncAutomations(): Promise<{ upserted: number; deleted: number }> {
    return this.request("/v1/automation/sync", { method: "POST" });
  }

  listAuditLog(params: { limit?: number; offset?: number } = {}): Promise<AuditLogRecord[]> {
    const query = new URLSearchParams();
    if (params.limit !== undefined) query.set("limit", String(params.limit));
    if (params.offset !== undefined) query.set("offset", String(params.offset));
    const suffix = query.size ? `?${query.toString()}` : "";
    return this.request(`/v1/audit-log${suffix}`);
  }

  listApiKeys(): Promise<ApiKeyRecord[]> {
    return this.request("/v1/api-keys");
  }

  createApiKey(input: {
    name: string;
    scope: "read-only" | "read-write" | "admin";
  }): Promise<ApiKeyRecord & { key: string }> {
    return this.request("/v1/api-keys", { method: "POST", body: input });
  }

  revokeApiKey(keyId: string): Promise<{ revoked: true }> {
    return this.request(`/v1/api-keys/${encodeURIComponent(keyId)}`, { method: "DELETE" });
  }

  listWebhookSubscriptions(): Promise<WebhookSubscription[]> {
    return this.request("/v1/webhook-subscriptions");
  }

  createWebhookSubscription(input: {
    url: string;
    events: WebhookSubscription["events"];
  }): Promise<WebhookSubscription & { secret: string }> {
    return this.request("/v1/webhook-subscriptions", { method: "POST", body: input });
  }

  deleteWebhookSubscription(subscriptionId: string): Promise<{ deleted: true }> {
    return this.request(`/v1/webhook-subscriptions/${encodeURIComponent(subscriptionId)}`, {
      method: "DELETE",
    });
  }

  listWebhookDeliveries(limit = 100): Promise<WebhookDeliveryRecord[]> {
    return this.request(`/v1/webhook-deliveries?limit=${encodeURIComponent(String(limit))}`);
  }

  retryWebhookDelivery(deliveryId: string): Promise<{ requeued: true; id: string }> {
    return this.request(`/v1/webhook-deliveries/${encodeURIComponent(deliveryId)}/retry`, {
      method: "POST",
    });
  }

  listConnectors(): Promise<ConnectorRecord[]> {
    return this.request("/v1/connectors");
  }

  disconnectConnector(service: string): Promise<{
    disconnected: true;
    providerRevocation: "succeeded" | "failed" | "skipped";
  }> {
    return this.request(`/v1/connectors/${encodeURIComponent(service)}`, { method: "DELETE" });
  }

  rotateConnectorEncryptionKey(): Promise<{
    rotated: number;
    alreadyCurrent: number;
    concurrentChanges: number;
    complete: boolean;
  }> {
    return this.request("/v1/connectors/rotate-encryption-key", { method: "POST" });
  }

  async startConnectorOAuth(
    service: "gmail" | "google-calendar" | "google-drive" | "microsoft" | "salesforce",
    signal?: AbortSignal,
  ): Promise<string> {
    const path = `/v1/connectors/oauth/start/${encodeURIComponent(service)}`;
    const response = await this.fetchImpl(new URL(path, this.baseUrl), {
      headers: { Authorization: `Bearer ${this.options.token}` },
      redirect: "manual",
      signal,
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("Location");
      if (!location)
        throw new AgentOSError("OAuth redirect did not include a location", response.status);
      return new URL(location, this.baseUrl).toString();
    }
    await this.readResponse<never>(response);
    throw new AgentOSError("OAuth start did not redirect", response.status);
  }

  listMcpServers(): Promise<McpServerRecord[]> {
    return this.request("/v1/connectors/mcp");
  }

  createMcpServer(input: { name: string; url: string; apiKey?: string }): Promise<McpServerRecord> {
    return this.request("/v1/connectors/mcp", { method: "POST", body: input });
  }

  deleteMcpServer(serverId: string): Promise<{ deleted: true }> {
    return this.request(`/v1/connectors/mcp/${encodeURIComponent(serverId)}`, {
      method: "DELETE",
    });
  }

  async triggerWebhookRoutine(
    routineId: string,
    secret: string,
    payload: string | Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<{ turnId: string; runId: string; routineRunId: string }> {
    const isText = typeof payload === "string";
    const response = await this.fetchImpl(
      new URL(`/v1/webhooks/${encodeURIComponent(routineId)}`, this.baseUrl),
      {
        method: "POST",
        signal,
        headers: {
          "X-Routine-Secret": secret,
          ...(isText ? {} : { "Content-Type": "application/json" }),
        },
        body: isText ? payload : JSON.stringify(payload),
      },
    );
    return this.readResponse(response);
  }

  listSubagents(): Promise<SubagentRecord[]> {
    return this.request("/v1/subagents");
  }

  getSubagent(subagentId: string): Promise<SubagentRecord> {
    return this.request(`/v1/subagents/${encodeURIComponent(subagentId)}`);
  }

  cancelSubagent(subagentId: string): Promise<{ subagentId: string; status: string }> {
    return this.request(`/v1/subagents/${encodeURIComponent(subagentId)}/cancel`, {
      method: "POST",
    });
  }

  steerSubagent(
    subagentId: string,
    message: string,
  ): Promise<{ subagentId: string; status: string }> {
    return this.request(`/v1/subagents/${encodeURIComponent(subagentId)}/steer`, {
      method: "POST",
      body: { message },
    });
  }

  connectWebSocket(createSocket: GatewaySocketFactory): GatewaySocket {
    const url = new URL(this.baseUrl);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.pathname = "/ws";
    url.search = "";
    url.hash = "";
    // Provide a runtime adapter that sets Authorization; browser WebSocket lacks custom headers.
    return createSocket(url.toString(), this.options.token);
  }

  sendPrompt(
    socket: GatewaySocket,
    agentId: string,
    prompt: string,
    attachments: unknown[] = [],
  ): void {
    socket.send(
      JSON.stringify({
        type: "sendPrompt",
        agentId,
        prompt,
        attachments,
        nonce: crypto.randomUUID(),
      }),
    );
  }

  approve(
    socket: GatewaySocket,
    frame: {
      agentId: string;
      runId: string;
      actionId: string;
      decision: "allow_once" | "deny" | "always_allow";
    },
  ): void {
    socket.send(JSON.stringify({ type: "approve", ...frame }));
  }

  interrupt(socket: GatewaySocket, frame: { agentId: string; runId: string }): void {
    socket.send(JSON.stringify({ type: "interrupt", ...frame }));
  }

  testRoutine(routineId: string) {
    return this.runRoutine(routineId);
  }

  getAuditLog(params?: { limit?: number; offset?: number }): Promise<AuditLogRecord[]> {
    const query = new URLSearchParams();
    if (params?.limit !== undefined) query.set("limit", String(params.limit));
    if (params?.offset !== undefined) query.set("offset", String(params.offset));
    const text = query.toString();
    return this.request(`/v1/audit-log${text ? `?${text}` : ""}`);
  }

  listMcp() {
    return this.listMcpServers();
  }

  addMcp(input: { name: string; url: string; apiKey?: string }) {
    return this.createMcpServer(input);
  }

  deleteMcp(serverId: string) {
    return this.deleteMcpServer(serverId);
  }
}
