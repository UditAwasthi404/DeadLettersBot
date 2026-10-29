export interface BotSummary {
  id: string;
  name: string;
  role: "main" | "peer" | "chief_of_staff" | "subagent";
}
export interface BotRecord extends BotSummary {
  accountId: string;
  systemPrompt: string;
  profileText: string;
  skills: string[];
  tools: string[];
  memorySettings: Record<string, unknown>;
  approvalSettings: Record<string, unknown>;
  inferenceSettings: { providerId?: string; model?: string };
  createdAt: string;
  updatedAt: string;
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
  | { type: "inter_bot_message"; senderBotId?: string };
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
  lastCheckedAt: string | null;
  createdAt?: string;
}
export interface SubagentRecord {
  id: string;
  parentBotId: string;
  taskDescription: string;
  allowedTools: string[];
  status: "queued" | "running" | "completed" | "error" | "cancelled";
  result: string | null;
  usage: { promptTokens: number; completionTokens: number; totalTokens: number } | null;
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
export interface SessionResult extends BootstrapResult {
  scopes: ApiKeyScope[];
}
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
  private readonly baseUrl: URL;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: AgentOSClientOptions) {
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

  getBot(botId: string): Promise<BotRecord> {
    return this.request(`/v1/bots/${encodeURIComponent(botId)}`);
  }

  createBot(input: {
    name: string;
    role?: "main" | "peer";
    systemPrompt?: string;
    profileText?: string;
  }): Promise<BotRecord> {
    return this.request("/v1/bots", { method: "POST", body: input });
  }

  updateBot(
    botId: string,
    input: Partial<
      Pick<
        BotRecord,
        | "name"
        | "systemPrompt"
        | "profileText"
        | "tools"
        | "skills"
        | "memorySettings"
        | "approvalSettings"
        | "inferenceSettings"
      >
    >,
  ): Promise<BotRecord> {
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

  assignSkill(skillId: string, botId: string): Promise<SkillRecord> {
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

  listAuditLog(limit = 100): Promise<AuditLogRecord[]> {
    return this.request(`/v1/audit-log?limit=${encodeURIComponent(String(limit))}`);
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
    service: "gmail" | "google-calendar" | "google-drive",
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
}
