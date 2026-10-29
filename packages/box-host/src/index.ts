/**
 * Box Host entry — runHostMain (REQ-H01, H03, H04).
 * Startup order per task (stop on first failure).
 */
import { inferenceReady } from "@agentOS/inference";
import { BlobStore, createDb, createRedis } from "@agentOS/shared";
import { createVMManager } from "@agentOS/vm-manager";
import { sql } from "drizzle-orm";
import { Hono } from "hono";
import { validateRuntimeConfig } from "./config.ts";
import { createGateway, runScheduledRoutines } from "./gateway.ts";
import { acquireProcessLock } from "./lock.ts";
import { processMcpHealthChecks } from "./mcp-health.ts";
import { resolveProviders } from "./providers.ts";
import { recoverInProgressTurns } from "./recovery.ts";
import { processWebhookDeliveries } from "./webhooks.ts";
import {
  drainAgent,
  processMemoryExtractionJobs,
  processMemorySynthesisJobs,
  reconcileSubagents,
} from "./worker.ts";

const PORT = Number(process.env.PORT ?? 8787);

function installCrashHandlers(): void {
  process.on("uncaughtException", (err) => {
    console.error("[crash] uncaughtException", err);
    process.exit(1);
  });
  process.on("unhandledRejection", (reason) => {
    console.error("[crash] unhandledRejection", reason);
    process.exit(1);
  });
}

export async function runHostMain(): Promise<void> {
  validateRuntimeConfig();
  installCrashHandlers();
  const releaseLock = acquireProcessLock();
  process.on("exit", releaseLock);
  process.on("SIGINT", () => {
    releaseLock();
    process.exit(0);
  });
  process.on("SIGTERM", () => {
    releaseLock();
    process.exit(0);
  });

  const providers = resolveProviders();

  // 1. Auth / inference readiness
  await inferenceReady(providers);

  // 2–3. Stores
  const db = createDb();
  const redis = createRedis();
  await redis.connect();

  // 4. Blob
  const blob = new BlobStore();
  await blob.ensureBuckets();

  // 4b. VM manager
  const vm = createVMManager();
  const accountVms = new Map<string, string>();

  // 5. Crash recovery
  const recovered = await recoverInProgressTurns(db, redis);

  // 6. Gateway
  const app = new Hono();
  app.get("/health", (c) => c.json({ ok: true }));
  app.get("/ready", async (c) => {
    try {
      await db.execute(sql`SELECT 1`);
      await redis.ping();
      return c.json({ ok: true });
    } catch (err) {
      return c.json({ ok: false, error: String(err) }, 503);
    }
  });
  const gatewayDeps = { db, redis, blob, providers, vm, accountVms };
  await reconcileSubagents(gatewayDeps);
  const { websocket } = createGateway(app, gatewayDeps);

  void processMcpHealthChecks(gatewayDeps).catch((err) =>
    console.error("[mcp] health worker failed", err),
  );
  const mcpHealthTimer = setInterval(() => {
    void processMcpHealthChecks(gatewayDeps).catch((err) =>
      console.error("[mcp] health worker failed", err),
    );
  }, 60_000);
  mcpHealthTimer.unref();

  void runScheduledRoutines(gatewayDeps);
  const routineTimer = setInterval(() => void runScheduledRoutines(gatewayDeps), 15_000);
  routineTimer.unref();

  void processWebhookDeliveries(db).catch((err) =>
    console.error("[webhooks] delivery worker failed", err),
  );
  const webhookTimer = setInterval(() => {
    void processWebhookDeliveries(db).catch((err) =>
      console.error("[webhooks] delivery worker failed", err),
    );
  }, 5_000);
  webhookTimer.unref();

  void processMemoryExtractionJobs(gatewayDeps).catch((err) =>
    console.error("[memory] extraction worker failed", err),
  );
  const memoryExtractionTimer = setInterval(() => {
    void processMemoryExtractionJobs(gatewayDeps).catch((err) =>
      console.error("[memory] extraction worker failed", err),
    );
  }, 10_000);
  memoryExtractionTimer.unref();

  void processMemorySynthesisJobs(gatewayDeps).catch((err) =>
    console.error("[memory] synthesis worker failed", err),
  );
  const memorySynthesisTimer = setInterval(() => {
    void processMemorySynthesisJobs(gatewayDeps).catch((err) =>
      console.error("[memory] synthesis worker failed", err),
    );
  }, 15_000);
  memorySynthesisTimer.unref();

  for (const agentId of recovered.agentIds) {
    void drainAgent(agentId, gatewayDeps);
  }

  // 7. Listen
  Bun.serve({
    port: PORT,
    fetch: app.fetch,
    websocket,
  });
  console.info(`box-host ready on :${PORT}`);
}

if (import.meta.main) {
  runHostMain().catch((err) => {
    console.error("[startup] failed", err);
    process.exit(1);
  });
}
