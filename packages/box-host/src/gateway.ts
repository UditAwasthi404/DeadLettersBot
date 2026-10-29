import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import {
  OAuthPkceClient,
  decryptConnectorSecret,
  decryptConnectorSecretWithKeyring,
  encryptConnectorSecret,
  googleOAuthConfig,
} from "@agentOS/connectors";
/**
 * WebSocket gateway + send pipeline (REQ-H06–H09).
 * Auth on Upgrade; frames from packages/shared protocol.ts.
 */
import type { ProviderFactory } from "@agentOS/inference";
import { isValidCron, matchesCron, nextCronOccurrence } from "@agentOS/routines";
import {
  type BlobStore,
  type ClientFrame,
  type Database,
  type RedisClient,
  type ServerFrame,
  accounts,
  apiKeys,
  auditLog,
  bots,
  connectorAccounts,
  incrementCounter,
  mcpServers,
  memories,
  memoryEvidence,
  observeHistogram,
  renderPrometheusMetrics,
  routineRuns,
  routines,
  skillVersions,
  skills,
  subagents,
  turns,
  webhookDeliveries,
  webhookSubscriptions,
} from "@agentOS/shared";
import { discoverMcpTools, validateMcpEndpoint } from "@agentOS/tools";
import type { VMManager } from "@agentOS/vm-manager";
import { and, desc, eq, gt, isNull, ne, or, sql } from "drizzle-orm";
import type { Hono } from "hono";
import { createBunWebSocket } from "hono/bun";
import { sign } from "hono/jwt";
import { AuthError, verifyBearerToken } from "./auth.ts";
import { queueRoutine } from "./routine-queue.ts";
import { enqueue } from "./scheduler.ts";
import { deleteWebhookSubscription } from "./webhooks.ts";
import { drainAgent } from "./worker.ts";

export interface GatewayDeps {
  db: Database;
  redis: RedisClient;
  blob: BlobStore;
  providers: ProviderFactory[];
  vm: VMManager;
  accountVms: Map<string, string>;
}

export interface GatewayHandle {
  websocket: ReturnType<typeof createBunWebSocket>["websocket"];
}

type ApiScope = "read-only" | "read-write" | "admin";
type AuthenticatedRequest = {
  accountId: string;
  scopes: ApiScope[];
  apiKeyId?: string;
  sessionVersion?: number;
};

type SkillStepInput = {
  instruction: string;
  approvalRequired?: boolean;
  onError?: "stop" | "retry" | "skip" | "notify_user" | "custom_prompt";
  maxAttempts?: number;
  customPrompt?: string;
};

function isValidSkillSteps(value: unknown): value is SkillStepInput[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.length <= 50 &&
    value.every(
      (step) =>
        typeof step?.instruction === "string" &&
        step.instruction.trim().length > 0 &&
        step.instruction.length <= 4000 &&
        (step.approvalRequired === undefined || typeof step.approvalRequired === "boolean") &&
        (step.onError === undefined ||
          ["stop", "retry", "skip", "notify_user", "custom_prompt"].includes(step.onError)) &&
        (step.maxAttempts === undefined ||
          (Number.isInteger(step.maxAttempts) &&
            step.maxAttempts >= 1 &&
            step.maxAttempts <= 10)) &&
        (step.customPrompt === undefined ||
          (typeof step.customPrompt === "string" && step.customPrompt.length <= 2000)) &&
        (step.onError !== "custom_prompt" || Boolean(step.customPrompt?.trim())),
    )
  );
}

async function authenticateRequest(
  authorization: string | undefined,
  db: GatewayDeps["db"],
): Promise<AuthenticatedRequest> {
  if (!authorization?.startsWith("Bearer ")) throw new AuthError("missing bearer token");
  const credential = authorization.slice(7).trim();
  if (!credential.startsWith("agk_")) return await verifyBearerToken(authorization, db);
  const keyHash = createHash("sha256").update(credential).digest("hex");
  const [row] = await db.select().from(apiKeys).where(eq(apiKeys.keyHash, keyHash)).limit(1);
  if (!row || row.revokedAt) throw new AuthError("invalid API key");
  await db.update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.id, row.id));
  return { accountId: row.accountId, scopes: row.scopes, apiKeyId: row.id };
}

export async function runScheduledRoutines(deps: GatewayDeps, now = new Date()): Promise<number> {
  const due = await deps.db.select().from(routines).where(eq(routines.enabled, true));
  let queued = 0;
  const minuteStart = new Date(now);
  minuteStart.setSeconds(0, 0);
  for (const routine of due) {
    if (
      routine.trigger.type !== "cron" ||
      !routine.trigger.schedule ||
      !matchesCron(routine.trigger.schedule, now)
    )
      continue;
    if (routine.lastTriggeredAt && routine.lastTriggeredAt >= minuteStart) continue;
    try {
      await queueRoutine(deps, routine, "", (botId) => void drainAgent(botId, deps));
      queued += 1;
    } catch (err) {
      console.error(`[routines] failed to enqueue ${routine.id}`, err);
    }
  }
  return queued;
}

export function createGateway(app: Hono, deps: GatewayDeps): GatewayHandle {
  const { upgradeWebSocket, websocket } = createBunWebSocket();
  app.use("*", async (c, next) => {
    const requestId = c.req.header("X-Request-ID")?.slice(0, 128) || crypto.randomUUID();
    const startedAt = performance.now();
    await next();
    const duration = (performance.now() - startedAt) / 1000;
    c.header("X-Request-ID", requestId);
    incrementCounter("agentos_http_requests_total", {
      method: c.req.method,
      status: String(c.res.status),
    });
    observeHistogram("agentos_http_request_duration_seconds", duration, {
      method: c.req.method,
    });
    console.log(
      JSON.stringify({
        level: "info",
        event: "http_request",
        requestId,
        method: c.req.method,
        path: c.req.path,
        status: c.res.status,
        durationMs: Math.round(duration * 1000),
      }),
    );
  });
  app.get("/metrics", (c) => {
    if (process.env.METRICS_ENABLED !== "1") return c.notFound();
    c.header("Content-Type", "text/plain; version=0.0.4; charset=utf-8");
    return c.body(renderPrometheusMetrics());
  });
  app.use("/v1/*", async (c, next) => {
    if (
      c.req.path === "/v1/auth/bootstrap" ||
      c.req.path === "/v1/connectors/oauth/callback" ||
      c.req.path.startsWith("/v1/webhooks/")
    )
      return next();
    let auth: Awaited<ReturnType<typeof authenticateRequest>>;
    try {
      auth = await authenticateRequest(c.req.header("Authorization"), deps.db);
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : "unauthorized" }, 401);
    }
    const isWrite = !["GET", "HEAD", "OPTIONS"].includes(c.req.method);
    if (isWrite && !auth.scopes.includes("admin") && !auth.scopes.includes("read-write"))
      return c.json({ error: "API key does not have write access" }, 403);
    const accountId = auth.accountId;
    const limit = Number(process.env.API_RATE_LIMIT_PER_MINUTE ?? 120);
    const bucket = Math.floor(Date.now() / 60_000);
    const key = `api-rate:${accountId}:${bucket}`;
    const count = await deps.redis.incr(key);
    if (count === 1) await deps.redis.expire(key, 65);
    if (count > limit) {
      c.header("Retry-After", String(60 - Math.floor((Date.now() % 60_000) / 1000)));
      return c.json({ error: "rate limit exceeded" }, 429);
    }
    await next();
  });

  app.get("/openapi.json", (c) =>
    c.json({
      openapi: "3.1.0",
      info: { title: "AgentOS API", version: "0.1.0" },
      servers: [{ url: "/" }],
      components: {
        securitySchemes: { bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" } },
        parameters: {
          botId: {
            in: "path",
            name: "botId",
            required: true,
            schema: { type: "string", format: "uuid" },
          },
          skillId: {
            in: "path",
            name: "skillId",
            required: true,
            schema: { type: "string", format: "uuid" },
          },
          routineId: {
            in: "path",
            name: "routineId",
            required: true,
            schema: { type: "string", format: "uuid" },
          },
          memoryId: {
            in: "path",
            name: "memoryId",
            required: true,
            schema: { type: "string", format: "uuid" },
          },
          keyId: {
            in: "path",
            name: "keyId",
            required: true,
            schema: { type: "string", format: "uuid" },
          },
          subscriptionId: {
            in: "path",
            name: "subscriptionId",
            required: true,
            schema: { type: "string", format: "uuid" },
          },
          deliveryId: {
            in: "path",
            name: "deliveryId",
            required: true,
            schema: { type: "string", format: "uuid" },
          },
          serverId: {
            in: "path",
            name: "serverId",
            required: true,
            schema: { type: "string", format: "uuid" },
          },
          subagentId: {
            in: "path",
            name: "subagentId",
            required: true,
            schema: { type: "string", format: "uuid" },
          },
          service: {
            in: "path",
            name: "service",
            required: true,
            schema: { type: "string", enum: ["gmail", "google-calendar", "google-drive"] },
          },
        },
      },
      security: [{ bearerAuth: [] }],
      paths: {
        "/health": {
          get: {
            summary: "Liveness probe",
            security: [],
            responses: { "200": { description: "Host process is alive" } },
          },
        },
        "/ready": {
          get: {
            summary: "Readiness probe for PostgreSQL and Redis",
            security: [],
            responses: {
              "200": { description: "Dependencies are ready" },
              "503": { description: "A dependency is unavailable" },
            },
          },
        },
        "/metrics": {
          get: {
            summary: "Prometheus metrics",
            security: [],
            responses: {
              "200": { description: "Prometheus text exposition" },
              "404": { description: "Metrics are disabled" },
            },
          },
        },
        "/docs": {
          get: {
            summary: "API documentation landing page",
            security: [],
            responses: { "200": { description: "HTML page linking to the OpenAPI specification" } },
          },
        },
        "/openapi.json": {
          get: {
            summary: "OpenAPI 3.1 document",
            security: [],
            responses: { "200": { description: "OpenAPI specification" } },
          },
        },
        "/v1/auth/bootstrap": {
          post: {
            summary: "Create the first account and issue a bearer token",
            security: [],
            responses: {
              "201": { description: "Account and token" },
              "409": { description: "Bootstrap already closed" },
            },
          },
        },
        "/v1/auth/session": {
          post: {
            summary: "Mint a replacement JWT using an existing authorized credential",
            responses: {
              "200": { description: "JWT with the caller's existing scopes" },
              "401": { description: "Invalid or revoked credential" },
              "403": { description: "A read-only credential cannot mint a session" },
            },
          },
        },
        "/v1/auth/sessions/revoke": {
          post: {
            summary: "Revoke every currently issued JWT session for this account",
            responses: {
              "200": { description: "Session version advanced" },
              "401": { description: "Invalid or revoked credential" },
              "403": { description: "Admin scope is required" },
            },
          },
        },
        "/v1/bots": {
          get: {
            summary: "List account bots",
            responses: { "200": { description: "Bot roster" } },
          },
          post: { summary: "Create a bot", responses: { "201": { description: "Created bot" } } },
        },
        "/v1/inference/providers": {
          get: {
            summary: "List configured inference providers",
            responses: { "200": { description: "Provider identifiers available to this account" } },
          },
        },
        "/v1/bots/{botId}": {
          parameters: [{ $ref: "#/components/parameters/botId" }],
          get: { summary: "Read a bot", responses: { "200": { description: "Bot" } } },
          patch: { summary: "Update a bot", responses: { "200": { description: "Updated bot" } } },
          delete: {
            summary: "Delete a bot without history",
            responses: {
              "200": { description: "Deleted" },
              "409": { description: "Bot has history or routines" },
            },
          },
        },
        "/v1/bots/{botId}/memory": {
          parameters: [{ $ref: "#/components/parameters/botId" }],
          get: {
            summary: "List visible bot memories",
            responses: { "200": { description: "Memory records" } },
          },
          post: {
            summary: "Create a memory",
            responses: { "201": { description: "Created memory" } },
          },
        },
        "/v1/bots/{botId}/memory/export": {
          parameters: [{ $ref: "#/components/parameters/botId" }],
          get: {
            summary: "Export visible bot memories",
            responses: { "200": { description: "Memory export" } },
          },
        },
        "/v1/bots/{botId}/memory/{memoryId}/evidence": {
          parameters: [
            { $ref: "#/components/parameters/botId" },
            { $ref: "#/components/parameters/memoryId" },
          ],
          get: {
            summary: "List source turns for a visible memory fact",
            responses: { "200": { description: "Memory evidence" } },
          },
        },
        "/v1/bots/{botId}/memory/{memoryId}": {
          parameters: [
            { $ref: "#/components/parameters/botId" },
            { $ref: "#/components/parameters/memoryId" },
          ],
          patch: {
            summary: "Edit memory",
            responses: { "200": { description: "Updated memory" } },
          },
          delete: { summary: "Delete memory", responses: { "200": { description: "Deleted" } } },
        },
        "/v1/skills": {
          get: { summary: "List skills", responses: { "200": { description: "Skills" } } },
          post: {
            summary: "Create a skill",
            responses: { "201": { description: "Created skill" } },
          },
        },
        "/v1/skills/{skillId}": {
          parameters: [{ $ref: "#/components/parameters/skillId" }],
          patch: {
            summary: "Create a new skill version",
            responses: { "200": { description: "Updated skill" } },
          },
          delete: {
            summary: "Delete an unused skill",
            responses: {
              "200": { description: "Deleted" },
              "409": { description: "Skill is attached to a routine" },
            },
          },
        },
        "/v1/skills/{skillId}/versions": {
          get: {
            summary: "List immutable skill versions",
            parameters: [{ $ref: "#/components/parameters/skillId" }],
            responses: {
              "200": { description: "Skill version history" },
              "404": { description: "Skill not found" },
            },
          },
        },
        "/v1/skills/{skillId}/rollback/{version}": {
          post: {
            summary: "Restore a prior skill snapshot as a new version",
            parameters: [
              { $ref: "#/components/parameters/skillId" },
              {
                in: "path",
                name: "version",
                required: true,
                schema: { type: "integer", minimum: 1 },
              },
            ],
            responses: {
              "200": { description: "New restored skill version" },
              "404": { description: "Skill or version not found" },
            },
          },
        },
        "/v1/skills/{skillId}/assign": {
          parameters: [{ $ref: "#/components/parameters/skillId" }],
          post: {
            summary: "Copy a skill onto a bot",
            responses: { "201": { description: "Bot-owned skill copy" } },
          },
        },
        "/v1/routines": {
          get: { summary: "List routines", responses: { "200": { description: "Routines" } } },
          post: {
            summary: "Create a cron, webhook, or inter-bot message routine",
            responses: { "201": { description: "Created routine" } },
          },
        },
        "/v1/subagents": {
          get: {
            summary: "List subagents started by account bots",
            responses: { "200": { description: "Subagent statuses" } },
          },
        },
        "/v1/subagents/{subagentId}": {
          parameters: [{ $ref: "#/components/parameters/subagentId" }],
          get: {
            summary: "Read a subagent result",
            responses: { "200": { description: "Subagent status" } },
          },
        },
        "/v1/routines/{routineId}/test": {
          parameters: [{ $ref: "#/components/parameters/routineId" }],
          post: {
            summary: "Queue a manual run",
            responses: { "202": { description: "Run queued" } },
          },
        },
        "/v1/routines/{routineId}": {
          parameters: [{ $ref: "#/components/parameters/routineId" }],
          patch: {
            summary:
              "Update routine details, bot/skill assignment, or trigger; a new webhook secret is returned once",
            parameters: [{ $ref: "#/components/parameters/routineId" }],
            responses: {
              "200": { description: "Updated routine and optional one-time webhook secret" },
              "404": { description: "Routine not found" },
            },
          },
          delete: {
            summary: "Delete a routine",
            parameters: [{ $ref: "#/components/parameters/routineId" }],
            responses: {
              "200": { description: "Deleted routine" },
              "404": { description: "Routine not found" },
            },
          },
        },
        "/v1/routines/{routineId}/history": {
          parameters: [{ $ref: "#/components/parameters/routineId" }],
          get: {
            summary: "Read latest routine runs",
            responses: { "200": { description: "Routine runs" } },
          },
        },
        "/v1/api-keys": {
          get: {
            summary: "List API keys without secret values",
            responses: { "200": { description: "API keys" } },
          },
          post: {
            summary: "Create a scoped API key; the secret is returned once",
            responses: { "201": { description: "New API key" } },
          },
        },
        "/v1/webhook-subscriptions": {
          get: {
            summary: "List outbound webhook subscriptions",
            responses: { "200": { description: "Subscriptions" } },
          },
          post: {
            summary: "Create a signed outbound webhook subscription",
            responses: { "201": { description: "Subscription and signing secret" } },
          },
        },
        "/v1/webhook-subscriptions/{subscriptionId}": {
          parameters: [{ $ref: "#/components/parameters/subscriptionId" }],
          delete: {
            summary: "Delete a webhook subscription",
            responses: { "200": { description: "Deleted" } },
          },
        },
        "/v1/webhook-deliveries": {
          get: {
            summary: "List outbound webhook delivery attempts",
            responses: { "200": { description: "Delivery history" } },
          },
        },
        "/v1/webhook-deliveries/{deliveryId}/retry": {
          parameters: [{ $ref: "#/components/parameters/deliveryId" }],
          post: {
            summary: "Retry a failed outbound webhook delivery",
            responses: { "200": { description: "Delivery requeued" } },
          },
        },
        "/v1/api-keys/{keyId}": {
          parameters: [{ $ref: "#/components/parameters/keyId" }],
          delete: {
            summary: "Revoke an API key",
            responses: { "200": { description: "Revoked" } },
          },
        },
        "/v1/audit-log": {
          get: {
            summary: "Read audit events retained for the last 90 days",
            responses: { "200": { description: "Audit events" } },
          },
        },
        "/v1/connectors": {
          get: {
            summary: "List connected OAuth services",
            responses: { "200": { description: "Connected services" } },
          },
        },
        "/v1/connectors/rotate-encryption-key": {
          post: {
            summary:
              "Re-encrypt this account's connector, MCP, and webhook secrets with the current key",
            responses: {
              "200": { description: "Rotation counts and whether a repeat pass is required" },
              "400": { description: "Current and previous keys are identical" },
              "503": { description: "Both current and previous encryption keys are required" },
              "403": { description: "Admin scope is required" },
            },
          },
        },
        "/v1/connectors/mcp": {
          get: {
            summary: "List configured MCP servers",
            responses: { "200": { description: "MCP servers and cached tool metadata" } },
          },
          post: {
            summary: "Connect an MCP server and discover its tools",
            responses: { "201": { description: "MCP server" } },
          },
        },
        "/v1/connectors/mcp/{serverId}": {
          parameters: [{ $ref: "#/components/parameters/serverId" }],
          delete: {
            summary: "Remove an MCP server",
            responses: { "200": { description: "Removed" } },
          },
        },
        "/v1/connectors/oauth/start/{service}": {
          parameters: [{ $ref: "#/components/parameters/service" }],
          get: {
            summary: "Start Google OAuth with PKCE",
            responses: { "302": { description: "Redirect to provider" } },
          },
        },
        "/v1/connectors/oauth/callback": {
          get: {
            summary: "Complete Google OAuth callback",
            security: [],
            parameters: [
              { in: "query", name: "code", required: true, schema: { type: "string" } },
              { in: "query", name: "state", required: true, schema: { type: "string" } },
            ],
            responses: {
              "302": { description: "OAuth flow completed; redirects to the desktop callback" },
              "400": { description: "Invalid or expired OAuth state" },
            },
          },
        },
        "/v1/connectors/{service}": {
          parameters: [{ $ref: "#/components/parameters/service" }],
          delete: {
            summary:
              "Revoke and disconnect a service; local credentials are deleted even if provider revocation fails",
            responses: { "200": { description: "Disconnected with provider revocation status" } },
          },
        },
        "/v1/webhooks/{routineId}": {
          parameters: [{ $ref: "#/components/parameters/routineId" }],
          post: {
            summary: "Trigger a webhook routine",
            security: [],
            parameters: [
              {
                in: "header",
                name: "X-Routine-Secret",
                required: true,
                schema: { type: "string" },
              },
            ],
            responses: {
              "202": { description: "Run queued" },
              "401": { description: "Invalid secret" },
            },
          },
        },
      },
    }),
  );
  app.get("/docs", (c) =>
    c.html(
      `<!doctype html><html><head><meta charset="utf-8"><title>AgentOS API</title></head><body><h1>AgentOS API</h1><p><a href="/openapi.json">OpenAPI 3.1 specification</a></p><p>Most endpoints require a bearer token from <code>POST /v1/auth/bootstrap</code>; the WebSocket gateway is <code>/ws</code>.</p></body></html>`,
    ),
  );

  app.post("/v1/auth/bootstrap", async (c) => {
    const lockToken = crypto.randomUUID();
    if ((await deps.redis.set("auth:bootstrap-lock", lockToken, "EX", 30, "NX")) !== "OK")
      return c.json({ error: "bootstrap is already in progress" }, 409);
    try {
      const existing = await deps.db.select({ id: accounts.id }).from(accounts).limit(1);
      if (existing.length)
        return c.json(
          { error: "bootstrap is closed; authenticate with an existing account token" },
          409,
        );
      const body = await c.req.json<{ email?: string; displayName?: string }>();
      if (!body.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email))
        return c.json({ error: "valid email is required" }, 400);
      const [account] = await deps.db
        .insert(accounts)
        .values({ email: body.email.toLowerCase(), displayName: body.displayName?.trim() || null })
        .returning();
      if (!account) return c.json({ error: "account could not be created" }, 500);
      const secret = process.env.JWT_SECRET;
      if (!secret) return c.json({ error: "JWT_SECRET is not configured" }, 503);
      const token = await sign(
        {
          accountId: account.id,
          sub: account.email,
          scopes: ["admin"],
          sessionVersion: account.sessionVersion,
          exp: Math.floor(Date.now() / 1000) + 86_400,
        },
        secret,
      );
      return c.json({ accountId: account.id, token, expiresInSeconds: 86_400 }, 201);
    } finally {
      if ((await deps.redis.get("auth:bootstrap-lock")) === lockToken)
        await deps.redis.del("auth:bootstrap-lock");
    }
  });

  app.post("/v1/auth/session", async (c) => {
    const auth = await authenticateRequest(c.req.header("Authorization"), deps.db);
    const [account] = await deps.db
      .select({ id: accounts.id, email: accounts.email, sessionVersion: accounts.sessionVersion })
      .from(accounts)
      .where(eq(accounts.id, auth.accountId))
      .limit(1);
    if (auth.sessionVersion !== undefined && auth.sessionVersion !== account?.sessionVersion)
      return c.json({ error: "session revoked" }, 401);
    const secret = process.env.JWT_SECRET;
    if (!account || !secret)
      return c.json({ error: "account or JWT signing key unavailable" }, 503);
    const expiresInSeconds = 86_400;
    const token = await sign(
      {
        accountId: account.id,
        sub: account.email,
        scopes: auth.scopes,
        sessionVersion: account.sessionVersion,
        exp: Math.floor(Date.now() / 1000) + expiresInSeconds,
      },
      secret,
    );
    return c.json({ accountId: account.id, token, scopes: auth.scopes, expiresInSeconds });
  });

  app.post("/v1/auth/sessions/revoke", async (c) => {
    const auth = await authenticateRequest(c.req.header("Authorization"), deps.db);
    if (!auth.scopes.includes("admin"))
      return c.json({ error: "admin scope is required to revoke account sessions" }, 403);
    const [account] = await deps.db
      .update(accounts)
      .set({ sessionVersion: sql`${accounts.sessionVersion} + 1`, updatedAt: new Date() })
      .where(eq(accounts.id, auth.accountId))
      .returning({ sessionVersion: accounts.sessionVersion });
    return account
      ? c.json({ revoked: true, sessionVersion: account.sessionVersion })
      : c.json({ error: "account not found" }, 404);
  });

  app.get("/v1/audit-log", async (c) => {
    const auth = await authenticateRequest(c.req.header("Authorization"), deps.db);
    const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    const requestedLimit = Number(c.req.query("limit") ?? 100);
    const limit = Number.isInteger(requestedLimit)
      ? Math.max(1, Math.min(requestedLimit, 500))
      : 100;
    const rows = await deps.db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.accountId, auth.accountId), gt(auditLog.createdAt, cutoff)))
      .orderBy(desc(auditLog.createdAt))
      .limit(limit);
    return c.json(rows);
  });

  app.get("/v1/api-keys", async (c) => {
    const auth = await authenticateRequest(c.req.header("Authorization"), deps.db);
    const rows = await deps.db
      .select({
        id: apiKeys.id,
        name: apiKeys.name,
        keyPrefix: apiKeys.keyPrefix,
        scopes: apiKeys.scopes,
        createdAt: apiKeys.createdAt,
        lastUsedAt: apiKeys.lastUsedAt,
        revokedAt: apiKeys.revokedAt,
      })
      .from(apiKeys)
      .where(eq(apiKeys.accountId, auth.accountId));
    return c.json(rows);
  });

  app.post("/v1/api-keys", async (c) => {
    const auth = await authenticateRequest(c.req.header("Authorization"), deps.db);
    const body = await c.req.json<{
      name?: string;
      scope?: "read-only" | "read-write" | "admin";
    }>();
    if (!body.name?.trim() || !["read-only", "read-write", "admin"].includes(body.scope ?? ""))
      return c.json({ error: "name and a valid scope are required" }, 400);
    if (body.scope === "admin" && !auth.scopes.includes("admin"))
      return c.json({ error: "only an account session can create an admin key" }, 403);
    const secret = `agk_${randomBytes(32).toString("base64url")}`;
    const keyHash = createHash("sha256").update(secret).digest("hex");
    const [row] = await deps.db
      .insert(apiKeys)
      .values({
        accountId: auth.accountId,
        name: body.name.trim(),
        keyHash,
        keyPrefix: secret.slice(0, 12),
        scopes: [body.scope as "read-only" | "read-write" | "admin"],
      })
      .returning({
        id: apiKeys.id,
        name: apiKeys.name,
        keyPrefix: apiKeys.keyPrefix,
        scopes: apiKeys.scopes,
        createdAt: apiKeys.createdAt,
      });
    return c.json({ ...row, key: secret }, 201);
  });

  app.delete("/v1/api-keys/:keyId", async (c) => {
    const auth = await authenticateRequest(c.req.header("Authorization"), deps.db);
    const [row] = await deps.db
      .update(apiKeys)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(apiKeys.id, c.req.param("keyId")),
          eq(apiKeys.accountId, auth.accountId),
          isNull(apiKeys.revokedAt),
        ),
      )
      .returning({ id: apiKeys.id });
    return row ? c.json({ revoked: true }) : c.json({ error: "not found" }, 404);
  });

  app.get("/v1/webhook-subscriptions", async (c) => {
    const auth = await authenticateRequest(c.req.header("Authorization"), deps.db);
    const rows = await deps.db
      .select({
        id: webhookSubscriptions.id,
        url: webhookSubscriptions.url,
        events: webhookSubscriptions.events,
        createdAt: webhookSubscriptions.createdAt,
      })
      .from(webhookSubscriptions)
      .where(eq(webhookSubscriptions.accountId, auth.accountId));
    return c.json(rows);
  });

  app.post("/v1/webhook-subscriptions", async (c) => {
    const auth = await authenticateRequest(c.req.header("Authorization"), deps.db);
    const body = await c.req.json<{ url?: string; events?: string[] }>();
    const allowedEvents = ["turn.settled", "routine.completed", "approval.required"] as const;
    if (
      !body.url ||
      !Array.isArray(body.events) ||
      !body.events.length ||
      body.events.some((event) => !allowedEvents.includes(event as (typeof allowedEvents)[number]))
    )
      return c.json({ error: "url and at least one supported event are required" }, 400);
    let url: URL;
    try {
      url = validateMcpEndpoint(body.url);
    } catch {
      return c.json({ error: "webhook URL must use HTTPS and a public hostname" }, 400);
    }
    if (url.protocol !== "https:" || ["localhost", "127.0.0.1"].includes(url.hostname))
      return c.json({ error: "outbound webhooks require an HTTPS public URL" }, 400);
    const encryptionKey = process.env.CONNECTOR_ENCRYPTION_KEY;
    if (!encryptionKey) return c.json({ error: "webhook encryption is not configured" }, 503);
    const existing = await deps.db
      .select({ id: webhookSubscriptions.id })
      .from(webhookSubscriptions)
      .where(eq(webhookSubscriptions.accountId, auth.accountId));
    if (existing.length >= 20) return c.json({ error: "Webhook subscription limit reached" }, 429);
    const secret = randomBytes(32).toString("hex");
    const [row] = await deps.db
      .insert(webhookSubscriptions)
      .values({
        accountId: auth.accountId,
        url: url.toString(),
        secretCiphertext: await encryptConnectorSecret(secret, encryptionKey),
        events: body.events as Array<"turn.settled" | "routine.completed" | "approval.required">,
      })
      .returning({
        id: webhookSubscriptions.id,
        url: webhookSubscriptions.url,
        events: webhookSubscriptions.events,
        createdAt: webhookSubscriptions.createdAt,
      });
    return c.json({ ...row, secret }, 201);
  });

  app.delete("/v1/webhook-subscriptions/:subscriptionId", async (c) => {
    const auth = await authenticateRequest(c.req.header("Authorization"), deps.db);
    const deleted = await deleteWebhookSubscription(
      deps.db,
      auth.accountId,
      c.req.param("subscriptionId"),
    );
    return deleted ? c.json({ deleted: true }) : c.json({ error: "not found" }, 404);
  });

  app.get("/v1/webhook-deliveries", async (c) => {
    const auth = await authenticateRequest(c.req.header("Authorization"), deps.db);
    const requestedLimit = Number(c.req.query("limit") ?? 100);
    const limit = Number.isInteger(requestedLimit)
      ? Math.max(1, Math.min(requestedLimit, 500))
      : 100;
    const rows = await deps.db
      .select({
        id: webhookDeliveries.id,
        eventId: webhookDeliveries.eventId,
        subscriptionId: webhookDeliveries.subscriptionId,
        event: webhookDeliveries.event,
        status: webhookDeliveries.status,
        attemptCount: webhookDeliveries.attemptCount,
        nextAttemptAt: webhookDeliveries.nextAttemptAt,
        lastStatusCode: webhookDeliveries.lastStatusCode,
        lastError: webhookDeliveries.lastError,
        responseSnippet: webhookDeliveries.responseSnippet,
        createdAt: webhookDeliveries.createdAt,
        updatedAt: webhookDeliveries.updatedAt,
        deliveredAt: webhookDeliveries.deliveredAt,
      })
      .from(webhookDeliveries)
      .where(eq(webhookDeliveries.accountId, auth.accountId))
      .orderBy(desc(webhookDeliveries.createdAt))
      .limit(limit);
    return c.json(rows);
  });

  app.post("/v1/webhook-deliveries/:deliveryId/retry", async (c) => {
    const auth = await authenticateRequest(c.req.header("Authorization"), deps.db);
    const [delivery] = await deps.db
      .update(webhookDeliveries)
      .set({
        status: "queued",
        attemptCount: 0,
        nextAttemptAt: new Date(),
        leaseUntil: null,
        lastStatusCode: null,
        lastError: null,
        responseSnippet: null,
        deliveredAt: null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(webhookDeliveries.id, c.req.param("deliveryId")),
          eq(webhookDeliveries.accountId, auth.accountId),
          eq(webhookDeliveries.status, "failed"),
        ),
      )
      .returning({ id: webhookDeliveries.id });
    return delivery
      ? c.json({ requeued: true, id: delivery.id })
      : c.json({ error: "failed delivery not found" }, 404);
  });

  app.get("/v1/connectors", async (c) => {
    const auth = await authenticateRequest(c.req.header("Authorization"), deps.db);
    const rows = await deps.db
      .select({
        service: connectorAccounts.service,
        scopes: connectorAccounts.scopes,
        expiresAt: connectorAccounts.expiresAt,
        connectedAt: connectorAccounts.createdAt,
      })
      .from(connectorAccounts)
      .where(eq(connectorAccounts.accountId, auth.accountId));
    return c.json(rows);
  });

  app.post("/v1/connectors/rotate-encryption-key", async (c) => {
    const auth = await authenticateRequest(c.req.header("Authorization"), deps.db);
    if (!auth.scopes.includes("admin"))
      return c.json({ error: "admin scope is required to rotate connector encryption" }, 403);
    const currentKey = process.env.CONNECTOR_ENCRYPTION_KEY;
    const previousKey = process.env.CONNECTOR_ENCRYPTION_KEY_PREVIOUS;
    if (!currentKey || !previousKey)
      return c.json(
        {
          error:
            "set new CONNECTOR_ENCRYPTION_KEY and old CONNECTOR_ENCRYPTION_KEY_PREVIOUS before rotating",
        },
        503,
      );
    if (currentKey === previousKey)
      return c.json({ error: "current and previous encryption keys must differ" }, 400);

    const counts = await deps.db.transaction(async (tx) => {
      let rotated = 0;
      let alreadyCurrent = 0;
      let concurrentChanges = 0;
      const oauthRows = await tx
        .select()
        .from(connectorAccounts)
        .where(eq(connectorAccounts.accountId, auth.accountId));
      for (const row of oauthRows) {
        const access = await decryptConnectorSecretWithKeyring(
          row.accessTokenCiphertext,
          currentKey,
          previousKey,
        );
        const refresh = row.refreshTokenCiphertext
          ? await decryptConnectorSecretWithKeyring(
              row.refreshTokenCiphertext,
              currentKey,
              previousKey,
            )
          : null;
        if (access.key === "current" && (!refresh || refresh.key === "current")) {
          alreadyCurrent += 1;
          continue;
        }
        const updated = await tx
          .update(connectorAccounts)
          .set({
            accessTokenCiphertext:
              access.key === "previous"
                ? await encryptConnectorSecret(access.plaintext, currentKey)
                : row.accessTokenCiphertext,
            refreshTokenCiphertext:
              refresh?.key === "previous"
                ? await encryptConnectorSecret(refresh.plaintext, currentKey)
                : row.refreshTokenCiphertext,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(connectorAccounts.id, row.id),
              eq(connectorAccounts.accessTokenCiphertext, row.accessTokenCiphertext),
              row.refreshTokenCiphertext
                ? eq(connectorAccounts.refreshTokenCiphertext, row.refreshTokenCiphertext)
                : isNull(connectorAccounts.refreshTokenCiphertext),
            ),
          )
          .returning({ id: connectorAccounts.id });
        if (updated.length) rotated += 1;
        else concurrentChanges += 1;
      }

      const mcpRows = await tx
        .select()
        .from(mcpServers)
        .where(eq(mcpServers.accountId, auth.accountId));
      for (const row of mcpRows) {
        if (!row.authTokenCiphertext) continue;
        const token = await decryptConnectorSecretWithKeyring(
          row.authTokenCiphertext,
          currentKey,
          previousKey,
        );
        if (token.key === "current") {
          alreadyCurrent += 1;
          continue;
        }
        const updated = await tx
          .update(mcpServers)
          .set({ authTokenCiphertext: await encryptConnectorSecret(token.plaintext, currentKey) })
          .where(
            and(
              eq(mcpServers.id, row.id),
              eq(mcpServers.authTokenCiphertext, row.authTokenCiphertext),
            ),
          )
          .returning({ id: mcpServers.id });
        if (updated.length) rotated += 1;
        else concurrentChanges += 1;
      }

      const subscriptions = await tx
        .select()
        .from(webhookSubscriptions)
        .where(eq(webhookSubscriptions.accountId, auth.accountId));
      for (const row of subscriptions) {
        const secret = await decryptConnectorSecretWithKeyring(
          row.secretCiphertext,
          currentKey,
          previousKey,
        );
        if (secret.key === "current") {
          alreadyCurrent += 1;
          continue;
        }
        const updated = await tx
          .update(webhookSubscriptions)
          .set({ secretCiphertext: await encryptConnectorSecret(secret.plaintext, currentKey) })
          .where(
            and(
              eq(webhookSubscriptions.id, row.id),
              eq(webhookSubscriptions.secretCiphertext, row.secretCiphertext),
            ),
          )
          .returning({ id: webhookSubscriptions.id });
        if (updated.length) rotated += 1;
        else concurrentChanges += 1;
      }

      await tx.insert(auditLog).values({
        accountId: auth.accountId,
        toolName: "RotateConnectorEncryptionKey",
        paramsHash: createHash("sha256")
          .update(JSON.stringify({ rotated, alreadyCurrent, concurrentChanges }))
          .digest("hex"),
        approvalStatus: "not_required",
        outcome: concurrentChanges ? "error" : "success",
        errorMessage: concurrentChanges
          ? "concurrent secret updates detected; run rotation again"
          : null,
      });
      return { rotated, alreadyCurrent, concurrentChanges };
    });
    return c.json({ ...counts, complete: counts.concurrentChanges === 0 });
  });

  app.get("/v1/connectors/mcp", async (c) => {
    const auth = await authenticateRequest(c.req.header("Authorization"), deps.db);
    const rows = await deps.db
      .select({
        id: mcpServers.id,
        name: mcpServers.name,
        url: mcpServers.url,
        cachedTools: mcpServers.cachedTools,
        lastHealth: mcpServers.lastHealth,
        lastCheckedAt: mcpServers.lastCheckedAt,
        createdAt: mcpServers.createdAt,
      })
      .from(mcpServers)
      .where(eq(mcpServers.accountId, auth.accountId));
    return c.json(rows);
  });

  app.post("/v1/connectors/mcp", async (c) => {
    const auth = await authenticateRequest(c.req.header("Authorization"), deps.db);
    const body = await c.req.json<{ name?: string; url?: string; apiKey?: string }>();
    if (!body.name?.trim() || !body.url) return c.json({ error: "name and url are required" }, 400);
    let url: URL;
    try {
      url = validateMcpEndpoint(body.url);
    } catch {
      return c.json({ error: "invalid MCP URL; use HTTPS and a public hostname" }, 400);
    }
    let discovered: Awaited<ReturnType<typeof discoverMcpTools>>;
    try {
      const key = process.env.CONNECTOR_ENCRYPTION_KEY;
      if (body.apiKey && !key) throw new Error("connector encryption is not configured");
      discovered = await discoverMcpTools(url.toString(), body.apiKey);
      const [row] = await deps.db
        .insert(mcpServers)
        .values({
          accountId: auth.accountId,
          name: body.name.trim(),
          url: url.toString(),
          authTokenCiphertext:
            body.apiKey && key ? await encryptConnectorSecret(body.apiKey, key) : null,
          cachedTools: discovered,
          lastHealth: "healthy",
          lastCheckedAt: new Date(),
        })
        .returning({
          id: mcpServers.id,
          name: mcpServers.name,
          url: mcpServers.url,
          cachedTools: mcpServers.cachedTools,
          lastHealth: mcpServers.lastHealth,
          lastCheckedAt: mcpServers.lastCheckedAt,
        });
      return c.json(row, 201);
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
    }
  });

  app.delete("/v1/connectors/mcp/:serverId", async (c) => {
    const auth = await authenticateRequest(c.req.header("Authorization"), deps.db);
    const [row] = await deps.db
      .delete(mcpServers)
      .where(
        and(eq(mcpServers.id, c.req.param("serverId")), eq(mcpServers.accountId, auth.accountId)),
      )
      .returning({ id: mcpServers.id });
    return row ? c.json({ deleted: true }) : c.json({ error: "not found" }, 404);
  });

  app.get("/v1/connectors/oauth/start/:service", async (c) => {
    const auth = await authenticateRequest(c.req.header("Authorization"), deps.db);
    const service = c.req.param("service");
    const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
    if (!clientId) return c.json({ error: "Google OAuth is not configured" }, 503);
    let config: ReturnType<typeof googleOAuthConfig>;
    try {
      config = googleOAuthConfig(service, clientId, process.env.GOOGLE_OAUTH_CLIENT_SECRET);
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
    }
    const redirectUri =
      process.env.GOOGLE_OAUTH_REDIRECT_URI ??
      `${new URL(c.req.url).origin}/v1/connectors/oauth/callback`;
    const oauth = new OAuthPkceClient(config);
    const request = await oauth.createAuthorizationRequest(redirectUri);
    await deps.redis.set(
      `oauth:pending:${request.state}`,
      JSON.stringify({
        accountId: auth.accountId,
        service,
        verifier: request.verifier,
        redirectUri,
      }),
      "EX",
      600,
    );
    return c.redirect(request.url, 302);
  });

  app.get("/v1/connectors/oauth/callback", async (c) => {
    const state = c.req.query("state") ?? "";
    const code = c.req.query("code") ?? "";
    const pendingKey = `oauth:pending:${state}`;
    const pendingRaw = state ? await deps.redis.getdel(pendingKey) : null;
    if (!pendingRaw || !code)
      return c.html(
        "<!doctype html><title>Connection failed</title><p>OAuth state is invalid or expired. Return to AgentOS and try again.</p>",
        400,
      );
    const pending = JSON.parse(pendingRaw) as {
      accountId: string;
      service: string;
      verifier: string;
      redirectUri: string;
    };
    const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
    if (!clientId) return c.text("Google OAuth is not configured", 503);
    const config = googleOAuthConfig(
      pending.service,
      clientId,
      process.env.GOOGLE_OAUTH_CLIENT_SECRET,
    );
    const tokens = await new OAuthPkceClient(config).exchangeCode(
      code,
      pending.verifier,
      pending.redirectUri,
    );
    const key = process.env.CONNECTOR_ENCRYPTION_KEY;
    if (!key) return c.text("CONNECTOR_ENCRYPTION_KEY is not configured", 503);
    const accessTokenCiphertext = await encryptConnectorSecret(tokens.accessToken, key);
    const refreshTokenCiphertext = tokens.refreshToken
      ? await encryptConnectorSecret(tokens.refreshToken, key)
      : undefined;
    await deps.db
      .insert(connectorAccounts)
      .values({
        accountId: pending.accountId,
        service: pending.service,
        accessTokenCiphertext,
        refreshTokenCiphertext: refreshTokenCiphertext ?? null,
        scopes: tokens.scope?.split(" ") ?? config.scopes,
        expiresAt: tokens.expiresIn ? new Date(Date.now() + tokens.expiresIn * 1000) : null,
      })
      .onConflictDoUpdate({
        target: [connectorAccounts.accountId, connectorAccounts.service],
        set: {
          accessTokenCiphertext,
          refreshTokenCiphertext: refreshTokenCiphertext ?? null,
          scopes: tokens.scope?.split(" ") ?? config.scopes,
          expiresAt: tokens.expiresIn ? new Date(Date.now() + tokens.expiresIn * 1000) : null,
          updatedAt: new Date(),
        },
      });
    return c.html(
      "<!doctype html><meta charset=utf-8><title>Connected</title><p>Google service connected. You can close this window and return to AgentOS.</p>",
    );
  });

  app.delete("/v1/connectors/:service", async (c) => {
    const auth = await authenticateRequest(c.req.header("Authorization"), deps.db);
    const service = c.req.param("service");
    const [connection] = await deps.db
      .select()
      .from(connectorAccounts)
      .where(
        and(
          eq(connectorAccounts.accountId, auth.accountId),
          eq(connectorAccounts.service, service),
        ),
      )
      .limit(1);
    if (!connection) return c.json({ error: "not found" }, 404);
    const key = process.env.CONNECTOR_ENCRYPTION_KEY;
    let providerRevocation: "succeeded" | "failed" | "skipped" = "skipped";
    if (key) {
      try {
        const token = await decryptConnectorSecret(
          connection.accessTokenCiphertext,
          key,
          process.env.CONNECTOR_ENCRYPTION_KEY_PREVIOUS,
        );
        const response = await fetch("https://oauth2.googleapis.com/revoke", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ token }),
          signal: AbortSignal.timeout(5_000),
        });
        providerRevocation = response.ok ? "succeeded" : "failed";
      } catch (err) {
        providerRevocation = "failed";
        console.warn(`[connectors] revoke failed for ${service}`, err);
      }
    }
    await deps.db.transaction(async (tx) => {
      await tx.delete(connectorAccounts).where(eq(connectorAccounts.id, connection.id));
      await tx.insert(auditLog).values({
        accountId: auth.accountId,
        toolName: `ConnectorDisconnect:${service}`,
        paramsHash: createHash("sha256").update(service).digest("hex"),
        outcome: "success",
        errorMessage:
          providerRevocation === "failed"
            ? "OAuth provider revocation failed; local credentials were deleted"
            : providerRevocation === "skipped"
              ? "OAuth provider revocation was unavailable; local credentials were deleted"
              : null,
      });
    });
    return c.json({ disconnected: true, providerRevocation });
  });

  app.get("/v1/skills", async (c) => {
    const auth = await authenticateRequest(c.req.header("Authorization"), deps.db);
    return c.json(await deps.db.select().from(skills).where(eq(skills.accountId, auth.accountId)));
  });
  app.post("/v1/skills", async (c) => {
    const auth = await authenticateRequest(c.req.header("Authorization"), deps.db);
    const body = await c.req.json<{
      name?: string;
      description?: string;
      ownerBotId?: string;
      steps?: Array<{
        instruction: string;
        approvalRequired?: boolean;
        onError?: "stop" | "retry" | "skip" | "notify_user" | "custom_prompt";
        maxAttempts?: number;
        customPrompt?: string;
      }>;
    }>();
    if (!body.name?.trim() || body.name.trim().length > 120)
      return c.json({ error: "name is required and must be 120 characters or fewer" }, 400);
    if (body.description && body.description.length > 2000)
      return c.json({ error: "description must be 2,000 characters or fewer" }, 400);
    if (!isValidSkillSteps(body.steps))
      return c.json({ error: "steps must contain 1 to 50 valid instructions" }, 400);
    if (body.ownerBotId) {
      const [owner] = await deps.db
        .select()
        .from(bots)
        .where(and(eq(bots.id, body.ownerBotId), eq(bots.accountId, auth.accountId)))
        .limit(1);
      if (!owner) return c.json({ error: "owner bot not found" }, 404);
    }
    const [skill] = await deps.db
      .insert(skills)
      .values({
        accountId: auth.accountId,
        ownerBotId: body.ownerBotId ?? null,
        name: body.name.trim(),
        description: body.description ?? "",
        steps: body.steps,
      })
      .returning();
    if (!skill) return c.json({ error: "skill could not be created" }, 500);
    await deps.db.insert(skillVersions).values({
      skillId: skill.id,
      version: skill.version,
      name: skill.name,
      description: skill.description,
      steps: skill.steps,
    });
    return c.json(skill, 201);
  });
  app.post("/v1/skills/:skillId/assign", async (c) => {
    const auth = await authenticateRequest(c.req.header("Authorization"), deps.db);
    const body = await c.req.json<{ botId?: string }>();
    if (!body.botId) return c.json({ error: "botId is required" }, 400);
    const [source] = await deps.db
      .select()
      .from(skills)
      .where(and(eq(skills.id, c.req.param("skillId")), eq(skills.accountId, auth.accountId)))
      .limit(1);
    if (!source) return c.json({ error: "skill not found" }, 404);
    const [owner] = await deps.db
      .select({ id: bots.id })
      .from(bots)
      .where(and(eq(bots.id, body.botId), eq(bots.accountId, auth.accountId)))
      .limit(1);
    if (!owner) return c.json({ error: "destination bot not found" }, 404);
    if (source.ownerBotId === owner.id)
      return c.json({ error: "skill is already owned by this bot" }, 409);

    const copy = await deps.db.transaction(async (tx) => {
      const [created] = await tx
        .insert(skills)
        .values({
          accountId: auth.accountId,
          ownerBotId: owner.id,
          name: source.name,
          description: source.description,
          steps: source.steps,
          version: 1,
        })
        .returning();
      if (!created) throw new Error("skill copy could not be created");
      await tx.insert(skillVersions).values({
        skillId: created.id,
        version: created.version,
        name: created.name,
        description: created.description,
        steps: created.steps,
      });
      return created;
    });
    return c.json({ ...copy, copiedFromSkillId: source.id }, 201);
  });
  app.get("/v1/skills/:skillId/versions", async (c) => {
    const auth = await authenticateRequest(c.req.header("Authorization"), deps.db);
    const [skill] = await deps.db
      .select()
      .from(skills)
      .where(and(eq(skills.id, c.req.param("skillId")), eq(skills.accountId, auth.accountId)))
      .limit(1);
    if (!skill) return c.json({ error: "not found" }, 404);
    return c.json(
      await deps.db
        .select()
        .from(skillVersions)
        .where(eq(skillVersions.skillId, skill.id))
        .orderBy(desc(skillVersions.version)),
    );
  });
  app.patch("/v1/skills/:skillId", async (c) => {
    const auth = await authenticateRequest(c.req.header("Authorization"), deps.db);
    const body = await c.req.json<{
      name?: string;
      description?: string;
      steps?: Array<{
        instruction: string;
        approvalRequired?: boolean;
        onError?: "stop" | "retry" | "skip" | "notify_user" | "custom_prompt";
        maxAttempts?: number;
        customPrompt?: string;
      }>;
    }>();
    if (body.name !== undefined && (!body.name.trim() || body.name.trim().length > 120))
      return c.json({ error: "name must contain 1 to 120 characters" }, 400);
    if (body.description !== undefined && body.description.length > 2000)
      return c.json({ error: "description must be 2,000 characters or fewer" }, 400);
    if (body.steps !== undefined && !isValidSkillSteps(body.steps))
      return c.json({ error: "steps must contain 1 to 50 valid instructions" }, 400);
    const [current] = await deps.db
      .select()
      .from(skills)
      .where(and(eq(skills.id, c.req.param("skillId")), eq(skills.accountId, auth.accountId)))
      .limit(1);
    if (!current) return c.json({ error: "not found" }, 404);
    const next = {
      name: body.name?.trim() || current.name,
      description: body.description ?? current.description,
      steps: body.steps ?? current.steps,
      version: current.version + 1,
    };
    await deps.db.insert(skillVersions).values({ skillId: current.id, ...next });
    const [skill] = await deps.db
      .update(skills)
      .set({
        name: body.name?.trim() || current.name,
        description: body.description ?? current.description,
        steps: body.steps ?? current.steps,
        version: current.version + 1,
        updatedAt: new Date(),
      })
      .where(eq(skills.id, current.id))
      .returning();
    return c.json(skill);
  });
  app.post("/v1/skills/:skillId/rollback/:version", async (c) => {
    const auth = await authenticateRequest(c.req.header("Authorization"), deps.db);
    const [skill] = await deps.db
      .select()
      .from(skills)
      .where(and(eq(skills.id, c.req.param("skillId")), eq(skills.accountId, auth.accountId)))
      .limit(1);
    const version = Number(c.req.param("version"));
    if (!skill || !Number.isInteger(version) || version < 1)
      return c.json({ error: "skill or version not found" }, 404);
    const [snapshot] = await deps.db
      .select()
      .from(skillVersions)
      .where(and(eq(skillVersions.skillId, skill.id), eq(skillVersions.version, version)))
      .limit(1);
    if (!snapshot) return c.json({ error: "version not found" }, 404);
    const nextVersion = skill.version + 1;
    await deps.db.insert(skillVersions).values({
      skillId: skill.id,
      version: nextVersion,
      name: snapshot.name,
      description: snapshot.description,
      steps: snapshot.steps,
    });
    const [updated] = await deps.db
      .update(skills)
      .set({
        name: snapshot.name,
        description: snapshot.description,
        steps: snapshot.steps,
        version: nextVersion,
        updatedAt: new Date(),
      })
      .where(eq(skills.id, skill.id))
      .returning();
    return c.json(updated);
  });
  app.delete("/v1/skills/:skillId", async (c) => {
    const auth = await authenticateRequest(c.req.header("Authorization"), deps.db);
    const linked = await deps.db
      .select({ id: routines.id })
      .from(routines)
      .where(eq(routines.skillId, c.req.param("skillId")))
      .limit(1);
    if (linked.length) return c.json({ error: "skill is used by a routine" }, 409);
    await deps.db.delete(skillVersions).where(eq(skillVersions.skillId, c.req.param("skillId")));
    const [row] = await deps.db
      .delete(skills)
      .where(and(eq(skills.id, c.req.param("skillId")), eq(skills.accountId, auth.accountId)))
      .returning({ id: skills.id });
    return row ? c.json({ deleted: true }) : c.json({ error: "not found" }, 404);
  });

  app.get("/v1/routines", async (c) => {
    const auth = await authenticateRequest(c.req.header("Authorization"), deps.db);
    const rows = await deps.db
      .select()
      .from(routines)
      .where(eq(routines.accountId, auth.accountId));
    const cronTimezone =
      process.env.TZ ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? "local time";
    return c.json(
      rows.map((routine) => ({
        ...routine,
        trigger:
          routine.trigger.type === "webhook" ? { type: "webhook" as const } : routine.trigger,
        nextRunAt:
          routine.enabled && routine.trigger.type === "cron"
            ? (nextCronOccurrence(routine.trigger.schedule)?.toISOString() ?? null)
            : null,
        cronTimezone: routine.trigger.type === "cron" ? cronTimezone : null,
      })),
    );
  });
  app.post("/v1/routines", async (c) => {
    const auth = await authenticateRequest(c.req.header("Authorization"), deps.db);
    const body = await c.req.json<{
      botId?: string;
      skillId?: string;
      name?: string;
      trigger?:
        | { type: "cron"; schedule?: string }
        | { type: "webhook" }
        | { type: "inter_bot_message"; senderBotId?: string };
      enabled?: boolean;
      onError?: "notify_user" | "retry" | "pause";
    }>();
    if (
      !body.botId ||
      !body.skillId ||
      !body.name?.trim() ||
      !body.trigger ||
      !["cron", "webhook", "inter_bot_message"].includes(body.trigger.type)
    )
      return c.json({ error: "botId, skillId, name, and a valid trigger are required" }, 400);
    const owned = await deps.db
      .select()
      .from(routines)
      .where(eq(routines.accountId, auth.accountId));
    if (owned.length >= 50) return c.json({ error: "Routine limit reached" }, 429);
    const [bot] = await deps.db
      .select()
      .from(bots)
      .where(and(eq(bots.id, body.botId), eq(bots.accountId, auth.accountId)))
      .limit(1);
    const [skill] = await deps.db
      .select()
      .from(skills)
      .where(and(eq(skills.id, body.skillId), eq(skills.accountId, auth.accountId)))
      .limit(1);
    if (!bot || !skill) return c.json({ error: "bot or skill not found" }, 404);
    if (skill.ownerBotId && skill.ownerBotId !== bot.id)
      return c.json(
        { error: "copy this bot-owned skill to the selected bot before scheduling it" },
        409,
      );
    if (body.trigger.type === "cron" && !isValidCron(body.trigger.schedule ?? ""))
      return c.json({ error: "cron schedule must be a valid five-field expression" }, 400);
    if (body.trigger.type === "inter_bot_message" && body.trigger.senderBotId) {
      const [senderBot] = await deps.db
        .select({ id: bots.id })
        .from(bots)
        .where(
          and(
            eq(bots.id, body.trigger.senderBotId),
            eq(bots.accountId, auth.accountId),
            ne(bots.role, "subagent"),
          ),
        )
        .limit(1);
      if (!senderBot) return c.json({ error: "sender bot not found" }, 404);
    }
    const trigger =
      body.trigger.type === "cron"
        ? { ...body.trigger, schedule: body.trigger.schedule as string }
        : body.trigger;
    const webhookSecret =
      body.trigger.type === "webhook" ? randomBytes(24).toString("hex") : undefined;
    const [routine] = await deps.db
      .insert(routines)
      .values({
        accountId: auth.accountId,
        botId: bot.id,
        skillId: skill.id,
        name: body.name.trim(),
        trigger: {
          ...trigger,
          ...(webhookSecret
            ? { secretHash: createHash("sha256").update(webhookSecret).digest("hex") }
            : {}),
        },
        enabled: body.enabled ?? true,
        onError: body.onError ?? "pause",
      })
      .returning();
    if (!routine) return c.json({ error: "routine could not be created" }, 500);
    return c.json(
      {
        routine: {
          ...routine,
          trigger:
            routine.trigger.type === "webhook" ? { type: "webhook" as const } : routine.trigger,
        },
        ...(webhookSecret ? { webhookSecret } : {}),
      },
      201,
    );
  });
  app.patch("/v1/routines/:routineId", async (c) => {
    const auth = await authenticateRequest(c.req.header("Authorization"), deps.db);
    const body = await c.req.json<{
      name?: string;
      botId?: string;
      skillId?: string;
      enabled?: boolean;
      onError?: "notify_user" | "retry" | "pause";
      trigger?:
        | { type: "cron"; schedule: string }
        | { type: "webhook" }
        | { type: "inter_bot_message"; senderBotId?: string };
    }>();
    const [current] = await deps.db
      .select()
      .from(routines)
      .where(and(eq(routines.id, c.req.param("routineId")), eq(routines.accountId, auth.accountId)))
      .limit(1);
    if (!current) return c.json({ error: "not found" }, 404);
    const nextBotId = body.botId ?? current.botId;
    const nextSkillId = body.skillId ?? current.skillId;
    if (body.botId !== undefined || body.skillId !== undefined) {
      const [nextBot] = await deps.db
        .select({ id: bots.id })
        .from(bots)
        .where(
          and(
            eq(bots.id, nextBotId),
            eq(bots.accountId, auth.accountId),
            ne(bots.role, "subagent"),
          ),
        )
        .limit(1);
      const [nextSkill] = await deps.db
        .select({ id: skills.id, ownerBotId: skills.ownerBotId })
        .from(skills)
        .where(and(eq(skills.id, nextSkillId), eq(skills.accountId, auth.accountId)))
        .limit(1);
      if (!nextBot || !nextSkill) return c.json({ error: "bot or skill not found" }, 404);
      if (nextSkill.ownerBotId && nextSkill.ownerBotId !== nextBot.id)
        return c.json(
          { error: "copy this bot-owned skill to the selected bot before scheduling it" },
          409,
        );
    }
    if (body.trigger?.type === "cron" && !isValidCron(body.trigger.schedule))
      return c.json({ error: "cron schedule must be a valid five-field expression" }, 400);
    if (body.trigger?.type === "inter_bot_message" && body.trigger.senderBotId) {
      const [senderBot] = await deps.db
        .select({ id: bots.id })
        .from(bots)
        .where(
          and(
            eq(bots.id, body.trigger.senderBotId),
            eq(bots.accountId, auth.accountId),
            ne(bots.role, "subagent"),
          ),
        )
        .limit(1);
      if (!senderBot) return c.json({ error: "sender bot not found" }, 404);
    }
    let webhookSecret: string | undefined;
    let trigger: (typeof current)["trigger"] | undefined = body.trigger;
    if (trigger?.type === "webhook") {
      if (current.trigger.type === "webhook" && current.trigger.secretHash) {
        trigger = { ...trigger, secretHash: current.trigger.secretHash };
      } else {
        webhookSecret = randomBytes(24).toString("hex");
        trigger = {
          ...trigger,
          secretHash: createHash("sha256").update(webhookSecret).digest("hex"),
        };
      }
    }
    const [routine] = await deps.db
      .update(routines)
      .set({
        ...(body.name?.trim() ? { name: body.name.trim().slice(0, 120) } : {}),
        ...(body.botId ? { botId: nextBotId } : {}),
        ...(body.skillId ? { skillId: nextSkillId } : {}),
        ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
        ...(body.onError ? { onError: body.onError } : {}),
        ...(trigger ? { trigger } : {}),
        updatedAt: new Date(),
      })
      .where(and(eq(routines.id, c.req.param("routineId")), eq(routines.accountId, auth.accountId)))
      .returning();
    return routine
      ? c.json({
          routine: {
            ...routine,
            trigger:
              routine.trigger.type === "webhook" ? { type: "webhook" as const } : routine.trigger,
          },
          ...(webhookSecret ? { webhookSecret } : {}),
        })
      : c.json({ error: "not found" }, 404);
  });
  app.delete("/v1/routines/:routineId", async (c) => {
    const auth = await authenticateRequest(c.req.header("Authorization"), deps.db);
    const [target] = await deps.db
      .select({ id: routines.id })
      .from(routines)
      .where(and(eq(routines.id, c.req.param("routineId")), eq(routines.accountId, auth.accountId)))
      .limit(1);
    if (!target) return c.json({ error: "not found" }, 404);
    await deps.db.delete(routineRuns).where(eq(routineRuns.routineId, target.id));
    await deps.db.delete(routines).where(eq(routines.id, target.id));
    return c.json({ deleted: true });
  });
  app.post("/v1/routines/:routineId/test", async (c) => {
    const auth = await authenticateRequest(c.req.header("Authorization"), deps.db);
    const [routine] = await deps.db
      .select()
      .from(routines)
      .where(and(eq(routines.id, c.req.param("routineId")), eq(routines.accountId, auth.accountId)))
      .limit(1);
    if (!routine) return c.json({ error: "not found" }, 404);
    return c.json(
      await queueRoutine(deps, routine, "Manual test run", (botId) => void drainAgent(botId, deps)),
      202,
    );
  });
  app.get("/v1/routines/:routineId/history", async (c) => {
    const auth = await authenticateRequest(c.req.header("Authorization"), deps.db);
    const [routine] = await deps.db
      .select()
      .from(routines)
      .where(and(eq(routines.id, c.req.param("routineId")), eq(routines.accountId, auth.accountId)))
      .limit(1);
    if (!routine) return c.json({ error: "not found" }, 404);
    return c.json(
      await deps.db
        .select()
        .from(routineRuns)
        .where(eq(routineRuns.routineId, routine.id))
        .orderBy(desc(routineRuns.triggeredAt))
        .limit(20),
    );
  });
  app.post("/v1/webhooks/:routineId", async (c) => {
    const [routine] = await deps.db
      .select()
      .from(routines)
      .where(eq(routines.id, c.req.param("routineId")))
      .limit(1);
    if (
      !routine ||
      !routine.enabled ||
      routine.trigger.type !== "webhook" ||
      !routine.trigger.secretHash
    )
      return c.json({ error: "not found" }, 404);
    const supplied = c.req.header("X-Routine-Secret") ?? "";
    const actual = createHash("sha256").update(supplied).digest("hex");
    const expected = Buffer.from(routine.trigger.secretHash, "hex");
    const received = Buffer.from(actual, "hex");
    const expectedBytes = new Uint8Array(expected.length);
    const receivedBytes = new Uint8Array(received.length);
    expectedBytes.set(expected);
    receivedBytes.set(received);
    if (
      expectedBytes.length !== receivedBytes.length ||
      !timingSafeEqual(expectedBytes, receivedBytes)
    )
      return c.json({ error: "unauthorized" }, 401);
    const payload = await c.req.text();
    return c.json(
      await queueRoutine(
        deps,
        routine,
        payload.slice(0, 2000),
        (botId) => void drainAgent(botId, deps),
      ),
      202,
    );
  });

  app.get("/v1/bots", async (c) => {
    const auth = await authenticateRequest(c.req.header("Authorization"), deps.db);
    const rows = await deps.db.select().from(bots).where(eq(bots.accountId, auth.accountId));
    return c.json(rows.filter((bot) => bot.role !== "subagent"));
  });

  app.get("/v1/inference/providers", async (c) => {
    await authenticateRequest(c.req.header("Authorization"), deps.db);
    return c.json({ providers: deps.providers.map(({ id }) => ({ id })) });
  });

  app.get("/v1/subagents", async (c) => {
    const auth = await authenticateRequest(c.req.header("Authorization"), deps.db);
    const rows = await deps.db
      .select({
        id: subagents.id,
        parentBotId: subagents.parentBotId,
        taskDescription: subagents.taskDescription,
        allowedTools: subagents.allowedTools,
        status: subagents.status,
        result: subagents.result,
        usage: subagents.usage,
        createdAt: subagents.createdAt,
        startedAt: subagents.startedAt,
        completedAt: subagents.completedAt,
      })
      .from(subagents)
      .where(eq(subagents.accountId, auth.accountId));
    return c.json(rows);
  });

  app.get("/v1/subagents/:subagentId", async (c) => {
    const auth = await authenticateRequest(c.req.header("Authorization"), deps.db);
    const [row] = await deps.db
      .select({
        id: subagents.id,
        parentBotId: subagents.parentBotId,
        taskDescription: subagents.taskDescription,
        allowedTools: subagents.allowedTools,
        status: subagents.status,
        result: subagents.result,
        usage: subagents.usage,
        createdAt: subagents.createdAt,
        startedAt: subagents.startedAt,
        completedAt: subagents.completedAt,
      })
      .from(subagents)
      .where(
        and(eq(subagents.id, c.req.param("subagentId")), eq(subagents.accountId, auth.accountId)),
      )
      .limit(1);
    return row ? c.json(row) : c.json({ error: "not found" }, 404);
  });

  app.get("/v1/bots/:botId", async (c) => {
    const auth = await authenticateRequest(c.req.header("Authorization"), deps.db);
    const [bot] = await deps.db
      .select()
      .from(bots)
      .where(
        and(
          eq(bots.id, c.req.param("botId")),
          eq(bots.accountId, auth.accountId),
          ne(bots.role, "subagent"),
        ),
      )
      .limit(1);
    return bot ? c.json(bot) : c.json({ error: "not found" }, 404);
  });

  app.delete("/v1/bots/:botId", async (c) => {
    const auth = await authenticateRequest(c.req.header("Authorization"), deps.db);
    const botId = c.req.param("botId");
    const [bot] = await deps.db
      .select()
      .from(bots)
      .where(and(eq(bots.id, botId), eq(bots.accountId, auth.accountId)))
      .limit(1);
    if (!bot) return c.json({ error: "not found" }, 404);
    const [history] = await deps.db
      .select({ id: turns.id })
      .from(turns)
      .where(eq(turns.botId, botId))
      .limit(1);
    const [automation] = await deps.db
      .select({ id: routines.id })
      .from(routines)
      .where(eq(routines.botId, botId))
      .limit(1);
    if (history || automation)
      return c.json({ error: "bot has turn history or routines; archive it instead" }, 409);
    await deps.db
      .delete(memories)
      .where(and(eq(memories.accountId, auth.accountId), eq(memories.botId, botId)));
    await deps.db.delete(bots).where(eq(bots.id, botId));
    return c.json({ deleted: true });
  });

  app.post("/v1/bots", async (c) => {
    const auth = await authenticateRequest(c.req.header("Authorization"), deps.db);
    const body = await c.req.json<{
      name?: string;
      systemPrompt?: string;
      profileText?: string;
      role?: "main" | "peer";
      tools?: string[];
    }>();
    if (!body.name?.trim()) return c.json({ error: "name is required" }, 400);
    const [bot] = await deps.db
      .insert(bots)
      .values({
        accountId: auth.accountId,
        name: body.name.trim(),
        systemPrompt: body.systemPrompt ?? "",
        profileText: body.profileText ?? "",
        role: body.role === "peer" ? "peer" : "main",
        tools: body.tools ?? [],
        skills: [],
        memorySettings: { agentScope: true, userScope: true, projectScope: false },
        approvalSettings: { autoReviewRules: [], defaultLevel: 0 },
        inferenceSettings: {},
      })
      .returning();
    return c.json(bot, 201);
  });

  app.patch("/v1/bots/:botId", async (c) => {
    const auth = await authenticateRequest(c.req.header("Authorization"), deps.db);
    const body = await c.req.json<{
      name?: string;
      systemPrompt?: string;
      profileText?: string;
      role?: "main" | "peer";
      tools?: string[];
      skills?: string[];
      memorySettings?: typeof bots.$inferSelect.memorySettings;
      approvalSettings?: typeof bots.$inferSelect.approvalSettings;
      inferenceSettings?: typeof bots.$inferSelect.inferenceSettings;
    }>();
    const update: Partial<typeof bots.$inferInsert> = { updatedAt: new Date() };
    if (body.name !== undefined) {
      if (!body.name.trim()) return c.json({ error: "name cannot be empty" }, 400);
      update.name = body.name.trim();
    }
    if (body.systemPrompt !== undefined) update.systemPrompt = body.systemPrompt;
    if (body.profileText !== undefined) update.profileText = body.profileText;
    if (body.role !== undefined) update.role = body.role;
    if (body.tools !== undefined) update.tools = body.tools;
    if (body.skills !== undefined) update.skills = body.skills;
    if (body.memorySettings !== undefined) update.memorySettings = body.memorySettings;
    if (body.approvalSettings !== undefined) update.approvalSettings = body.approvalSettings;
    if (body.inferenceSettings !== undefined) {
      const { providerId, model } = body.inferenceSettings;
      if (
        providerId !== undefined &&
        !deps.providers.some((provider) => provider.id === providerId)
      )
        return c.json({ error: "unknown inference provider" }, 400);
      if (model !== undefined && (typeof model !== "string" || model.length > 200))
        return c.json({ error: "model must be 200 characters or fewer" }, 400);
      update.inferenceSettings = {
        ...(providerId ? { providerId } : {}),
        ...(model?.trim() ? { model: model.trim() } : {}),
      };
    }
    const [bot] = await deps.db
      .update(bots)
      .set(update)
      .where(
        and(
          eq(bots.id, c.req.param("botId")),
          eq(bots.accountId, auth.accountId),
          ne(bots.role, "subagent"),
        ),
      )
      .returning();
    return bot ? c.json(bot) : c.json({ error: "not found" }, 404);
  });

  app.get("/v1/bots/:botId/memory", async (c) => {
    const auth = await authenticateRequest(c.req.header("Authorization"), deps.db);
    const botId = c.req.param("botId");
    const [bot] = await deps.db.select().from(bots).where(eq(bots.id, botId)).limit(1);
    if (!bot || bot.accountId !== auth.accountId || bot.role === "subagent")
      return c.json({ error: "not found" }, 404);
    const rows = await deps.db
      .select()
      .from(memories)
      .where(eq(memories.accountId, auth.accountId));
    return c.json(
      rows.filter(
        (m) =>
          m.scope === "user" ||
          (m.scope === "agent" && m.botId === botId) ||
          (m.scope === "project" && m.projectId === bot.memorySettings.projectId),
      ),
    );
  });

  app.get("/v1/bots/:botId/memory/export", async (c) => {
    const auth = await authenticateRequest(c.req.header("Authorization"), deps.db);
    const botId = c.req.param("botId");
    const [bot] = await deps.db.select().from(bots).where(eq(bots.id, botId)).limit(1);
    if (!bot || bot.accountId !== auth.accountId || bot.role === "subagent")
      return c.json({ error: "not found" }, 404);
    const rows = await deps.db
      .select()
      .from(memories)
      .where(eq(memories.accountId, auth.accountId));
    return c.json({
      botId,
      memories: rows.filter(
        (m) =>
          m.scope === "user" || m.botId === botId || m.projectId === bot.memorySettings.projectId,
      ),
    });
  });

  app.get("/v1/bots/:botId/memory/:memoryId/evidence", async (c) => {
    const auth = await authenticateRequest(c.req.header("Authorization"), deps.db);
    const botId = c.req.param("botId");
    const [bot] = await deps.db.select().from(bots).where(eq(bots.id, botId)).limit(1);
    if (!bot || bot.accountId !== auth.accountId || bot.role === "subagent")
      return c.json({ error: "not found" }, 404);
    const [memory] = await deps.db
      .select({
        id: memories.id,
        scope: memories.scope,
        botId: memories.botId,
        projectId: memories.projectId,
      })
      .from(memories)
      .where(and(eq(memories.id, c.req.param("memoryId")), eq(memories.accountId, auth.accountId)))
      .limit(1);
    const visible =
      memory?.scope === "user" ||
      (memory?.scope === "agent" && memory.botId === botId) ||
      (memory?.scope === "project" && memory.projectId === bot.memorySettings.projectId);
    if (!memory || !visible) return c.json({ error: "not found" }, 404);
    const entries = await deps.db
      .select({
        id: memoryEvidence.id,
        turnId: memoryEvidence.turnId,
        createdAt: memoryEvidence.createdAt,
      })
      .from(memoryEvidence)
      .where(
        and(eq(memoryEvidence.accountId, auth.accountId), eq(memoryEvidence.memoryId, memory.id)),
      )
      .orderBy(desc(memoryEvidence.createdAt));
    return c.json(entries);
  });

  app.post("/v1/bots/:botId/memory", async (c) => {
    const auth = await authenticateRequest(c.req.header("Authorization"), deps.db);
    const botId = c.req.param("botId");
    const [bot] = await deps.db.select().from(bots).where(eq(bots.id, botId)).limit(1);
    if (!bot || bot.accountId !== auth.accountId || bot.role === "subagent")
      return c.json({ error: "not found" }, 404);
    const body = await c.req.json<{
      scope?: "agent" | "user" | "project";
      content?: string;
      source?: string;
      projectId?: string;
    }>();
    if (!body.content?.trim() || !["agent", "user", "project"].includes(body.scope ?? ""))
      return c.json({ error: "scope and content are required" }, 400);
    const scope = body.scope as "agent" | "user" | "project";
    if (scope === "project" && body.projectId !== bot.memorySettings.projectId)
      return c.json({ error: "invalid project scope" }, 400);
    const [row] = await deps.db
      .insert(memories)
      .values({
        accountId: auth.accountId,
        botId: scope === "agent" ? botId : null,
        projectId: scope === "project" ? (body.projectId ?? null) : null,
        scope,
        content: body.content.trim(),
        source: body.source ?? "user",
        isUserAuthored: true,
      })
      .returning();
    return c.json(row, 201);
  });

  app.patch("/v1/bots/:botId/memory/:memoryId", async (c) => {
    const auth = await authenticateRequest(c.req.header("Authorization"), deps.db);
    const botId = c.req.param("botId");
    const [bot] = await deps.db.select().from(bots).where(eq(bots.id, botId)).limit(1);
    if (!bot || bot.accountId !== auth.accountId || bot.role === "subagent")
      return c.json({ error: "not found" }, 404);
    const body = await c.req.json<{ content?: string }>();
    if (!body.content?.trim()) return c.json({ error: "content is required" }, 400);
    const [row] = await deps.db
      .update(memories)
      .set({ content: body.content.trim(), isUserAuthored: true, updatedAt: new Date() })
      .where(
        and(
          eq(memories.id, c.req.param("memoryId")),
          eq(memories.accountId, auth.accountId),
          or(
            eq(memories.scope, "user"),
            and(eq(memories.scope, "agent"), eq(memories.botId, botId)),
            and(
              eq(memories.scope, "project"),
              eq(memories.projectId, bot.memorySettings.projectId ?? ""),
            ),
          ),
        ),
      )
      .returning();
    if (!row) return c.json({ error: "not found" }, 404);
    return c.json(row);
  });

  app.delete("/v1/bots/:botId/memory/:memoryId", async (c) => {
    const auth = await authenticateRequest(c.req.header("Authorization"), deps.db);
    const botId = c.req.param("botId");
    const [bot] = await deps.db.select().from(bots).where(eq(bots.id, botId)).limit(1);
    if (!bot || bot.accountId !== auth.accountId || bot.role === "subagent")
      return c.json({ error: "not found" }, 404);
    const [row] = await deps.db
      .delete(memories)
      .where(
        and(
          eq(memories.id, c.req.param("memoryId")),
          eq(memories.accountId, auth.accountId),
          or(
            eq(memories.scope, "user"),
            and(eq(memories.scope, "agent"), eq(memories.botId, botId)),
            and(
              eq(memories.scope, "project"),
              eq(memories.projectId, bot.memorySettings.projectId ?? ""),
            ),
          ),
        ),
      )
      .returning();
    if (!row) return c.json({ error: "not found" }, 404);
    return c.json({ deleted: true });
  });

  app.get("/ws", async (c, next) => {
    try {
      await authenticateRequest(c.req.header("Authorization"), deps.db);
    } catch (err) {
      const msg = err instanceof AuthError ? err.message : "unauthorized";
      return c.text(msg, 401);
    }
    await next();
  });

  app.get(
    "/ws",
    upgradeWebSocket((c) => {
      const authHeader = c.req.header("Authorization");
      let accountId = "";

      return {
        async onOpen(_evt, ws) {
          try {
            const auth = await authenticateRequest(authHeader, deps.db);
            if (!auth.scopes.includes("admin") && !auth.scopes.includes("read-write")) {
              ws.close(1008, "write access required");
              return;
            }
            accountId = auth.accountId;
            console.info(`[gateway] connected account=${accountId}`);
          } catch {
            ws.close(1008, "unauthorized");
          }
        },
        async onMessage(evt, ws) {
          const send = (frame: ServerFrame) => {
            ws.send(JSON.stringify(frame));
          };
          try {
            const raw = typeof evt.data === "string" ? evt.data : String(evt.data);
            const frame = JSON.parse(raw) as ClientFrame;
            await handleClientFrame(frame, { ...deps, accountId, send });
          } catch (err) {
            console.error("[gateway] message error", err);
            send({
              type: "error",
              agentId: "",
              runId: "",
              code: "bad_frame",
              message: err instanceof Error ? err.message : String(err),
            });
          }
        },
        onClose() {
          console.info(`[gateway] disconnected account=${accountId}`);
        },
      };
    }),
  );

  return { websocket };
}

interface FrameCtx extends GatewayDeps {
  accountId: string;
  send: (frame: ServerFrame) => void;
}

async function handleClientFrame(frame: ClientFrame, ctx: FrameCtx): Promise<void> {
  switch (frame.type) {
    case "sendPrompt":
      await handleSendPrompt(frame, ctx);
      return;
    case "interrupt":
      if ((await ctx.redis.get(`run:${frame.runId}:agentId`)) !== frame.agentId) return;
      {
        const [bot] = await ctx.db.select().from(bots).where(eq(bots.id, frame.agentId)).limit(1);
        if (!bot || bot.accountId !== ctx.accountId) return;
      }
      await ctx.redis.set(`run:${frame.runId}:cancelled`, "1", "EX", 3600);
      return;
    case "approve":
      if ((await ctx.redis.get(`run:${frame.runId}:agentId`)) !== frame.agentId) return;
      {
        const [bot] = await ctx.db.select().from(bots).where(eq(bots.id, frame.agentId)).limit(1);
        if (!bot || bot.accountId !== ctx.accountId) return;
      }
      await ctx.redis.set(`approval:${frame.runId}:${frame.actionId}`, frame.decision, "EX", 300);
      await ctx.redis.publish(
        `approval-channel:${frame.runId}`,
        JSON.stringify({ actionId: frame.actionId, decision: frame.decision }),
      );
      return;
    default:
      ctx.send({
        type: "error",
        agentId: "",
        runId: "",
        code: "unknown_frame",
        message: "unsupported frame type",
      });
  }
}

async function handleSendPrompt(
  frame: Extract<ClientFrame, { type: "sendPrompt" }>,
  ctx: FrameCtx,
): Promise<void> {
  if (!frame.agentId || !frame.nonce || typeof frame.prompt !== "string") {
    ctx.send({
      type: "error",
      agentId: frame.agentId ?? "",
      runId: "",
      code: "invalid_sendPrompt",
      message: "agentId, nonce, and prompt are required",
    });
    return;
  }

  const set = await ctx.redis.set(`nonce:${frame.nonce}`, "1", "EX", 86400, "NX");
  if (set !== "OK") {
    ctx.send({
      type: "error",
      agentId: frame.agentId,
      runId: "",
      code: "duplicate_nonce",
      message: "nonce already used",
    });
    return;
  }

  const [bot] = await ctx.db.select().from(bots).where(eq(bots.id, frame.agentId)).limit(1);
  if (!bot || bot.accountId !== ctx.accountId || bot.role === "subagent") {
    ctx.send({
      type: "error",
      agentId: frame.agentId,
      runId: "",
      code: "bot_not_found",
      message: "bot not found for account",
    });
    return;
  }

  const turnId = crypto.randomUUID();
  const runId = crypto.randomUUID();
  let durable = true;
  try {
    await ctx.db.insert(turns).values({
      id: turnId,
      botId: frame.agentId,
      runId,
      type: "user",
      input: {
        prompt: frame.prompt,
        attachments: frame.attachments ?? [],
        nonce: frame.nonce,
      },
      state: "pending",
    });
  } catch (err) {
    durable = false;
    console.warn("[send] input not saved durably", { nonce: frame.nonce, err });
  }

  ctx.send({ type: "accepted", echoId: turnId, nonce: frame.nonce });
  if (!durable) return;

  await enqueue(ctx.redis, frame.agentId, "user", {
    turnId,
    runId,
    botId: frame.agentId,
    accountId: ctx.accountId,
    priority: frame.routingOptions?.priority,
  });
  await ctx.redis.set(`run:${runId}:agentId`, frame.agentId, "EX", 86400);

  void drainAgent(frame.agentId, ctx, ctx.send);
}
