/**
 * Box Host entry — runHostMain (REQ-H01, H03, H04).
 * Startup order per task (stop on first failure).
 */
import { inferenceReady } from "@agentOS/inference";
import { BlobStore, adjustGauge, createDb, createRedis } from "@agentOS/shared";
import { createVMManager, gcIdleVMs } from "@agentOS/vm-manager";
import { sql } from "drizzle-orm";
import { Hono } from "hono";
import { reconcileAutomationShadows } from "./automation-sync.ts";
import { validateRuntimeConfig } from "./config.ts";
import { pollConnectorEvents } from "./connector-events.ts";
import { startFileChangeWatcher } from "./file-watch.ts";
import { createGateway, runScheduledRoutines } from "./gateway.ts";
import { acquireProcessLock } from "./lock.ts";
import { loggedError, logger } from "./logger.ts";
import { processMcpHealthChecks } from "./mcp-health.ts";
import { resolveProviders } from "./providers.ts";
import { recoverInProgressTurns } from "./recovery.ts";
import { shutdownTelemetry, startTelemetry } from "./telemetry.ts";
import { processWebhookDeliveries } from "./webhooks.ts";
import {
  detectStalledSubagents,
  drainAgent,
  processMemoryExtractionJobs,
  processMemorySynthesisJobs,
  reconcileSubagents,
} from "./worker.ts";

const PORT = Number(process.env.PORT ?? 8787);

function installCrashHandlers(): void {
  process.on("uncaughtException", (err) => {
    logger.fatal(loggedError(err), "uncaughtException");
    void shutdownTelemetry().finally(() => process.exit(1));
  });
  process.on("unhandledRejection", (reason) => {
    logger.fatal(loggedError(reason), "unhandledRejection");
    void shutdownTelemetry().finally(() => process.exit(1));
  });
}

export async function runHostMain(): Promise<void> {
  validateRuntimeConfig();
  installCrashHandlers();
  const telemetryEnabled = startTelemetry();
  const releaseLock = acquireProcessLock();
  process.on("exit", releaseLock);
  process.on("SIGINT", () => {
    releaseLock();
    void shutdownTelemetry().finally(() => process.exit(0));
  });
  process.on("SIGTERM", () => {
    releaseLock();
    void shutdownTelemetry().finally(() => process.exit(0));
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
  const vmResources = new Map<
    string,
    { cpuPercent: number; memoryUsedBytes: number; memoryLimitBytes: number }
  >();
  const vmStatuses = ["running", "sleeping", "starting", "terminated"] as const;
  const knownVmCounts = new Map<(typeof vmStatuses)[number], number>();
  let knownCpuPercent = 0;
  let knownMemoryUsedBytes = 0;
  let knownMemoryLimitBytes = 0;
  const refreshVmMetrics = async () => {
    const vms = await vm.listVMs();
    const counts = new Map<(typeof vmStatuses)[number], number>(vmStatuses.map((s) => [s, 0]));
    for (const info of vms) counts.set(info.status, (counts.get(info.status) ?? 0) + 1);
    for (const status of vmStatuses) {
      const next = counts.get(status) ?? 0;
      const previous = knownVmCounts.get(status) ?? 0;
      adjustGauge("agentos_vm_containers", next - previous, { status });
      knownVmCounts.set(status, next);
    }

    const runningVms = vms.filter((info) => info.status === "running");
    const runningIds = new Set(runningVms.map((info) => info.vmId));
    for (const vmId of vmResources.keys()) if (!runningIds.has(vmId)) vmResources.delete(vmId);
    let nextVm = 0;
    await Promise.all(
      Array.from({ length: Math.min(4, runningVms.length) }, async () => {
        while (nextVm < runningVms.length) {
          const info = runningVms[nextVm++];
          if (!info) continue;
          try {
            const stats = await vm.getVMStats(info.vmId);
            if (stats) vmResources.set(info.vmId, stats);
          } catch (err) {
            logger.warn({ ...loggedError(err), vmId: info.vmId }, "vm stats refresh failed");
          }
        }
      }),
    );
    const cpuPercent = [...vmResources.values()].reduce(
      (total, stats) => total + stats.cpuPercent,
      0,
    );
    const memoryUsedBytes = [...vmResources.values()].reduce(
      (total, stats) => total + stats.memoryUsedBytes,
      0,
    );
    const memoryLimitBytes = [...vmResources.values()].reduce(
      (total, stats) => total + stats.memoryLimitBytes,
      0,
    );
    adjustGauge("agentos_vm_cpu_usage_percent", cpuPercent - knownCpuPercent);
    adjustGauge("agentos_vm_memory_usage_bytes", memoryUsedBytes - knownMemoryUsedBytes);
    adjustGauge("agentos_vm_memory_limit_bytes", memoryLimitBytes - knownMemoryLimitBytes);
    knownCpuPercent = cpuPercent;
    knownMemoryUsedBytes = memoryUsedBytes;
    knownMemoryLimitBytes = memoryLimitBytes;
  };

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
  await reconcileAutomationShadows(db);
  await reconcileSubagents(gatewayDeps);
  void detectStalledSubagents(gatewayDeps).catch((err) =>
    logger.error(loggedError(err), "subagent stall check failed"),
  );
  const stallTimer = setInterval(() => {
    void detectStalledSubagents(gatewayDeps).catch((err) =>
      logger.error(loggedError(err), "subagent stall check failed"),
    );
  }, 30_000);
  stallTimer.unref();
  const { websocket } = createGateway(app, gatewayDeps);

  void processMcpHealthChecks(gatewayDeps).catch((err) =>
    logger.error(loggedError(err), "mcp health worker failed"),
  );
  const mcpHealthTimer = setInterval(() => {
    void processMcpHealthChecks(gatewayDeps).catch((err) =>
      logger.error(loggedError(err), "mcp health worker failed"),
    );
  }, 60_000);
  mcpHealthTimer.unref();

  startFileChangeWatcher(gatewayDeps);
  void pollConnectorEvents(gatewayDeps).catch((err) =>
    logger.error(loggedError(err), "connector event poll failed"),
  );
  const connectorEventTimer = setInterval(() => {
    void pollConnectorEvents(gatewayDeps).catch((err) =>
      logger.error(loggedError(err), "connector event poll failed"),
    );
  }, 60_000);
  connectorEventTimer.unref();
  void runScheduledRoutines(gatewayDeps);
  const routineTimer = setInterval(() => void runScheduledRoutines(gatewayDeps), 15_000);
  routineTimer.unref();

  void processWebhookDeliveries(db).catch((err) =>
    logger.error(loggedError(err), "webhook delivery worker failed"),
  );
  const webhookTimer = setInterval(() => {
    void processWebhookDeliveries(db).catch((err) =>
      logger.error(loggedError(err), "webhook delivery worker failed"),
    );
  }, 5_000);
  webhookTimer.unref();

  void processMemoryExtractionJobs(gatewayDeps).catch((err) =>
    logger.error(loggedError(err), "memory extraction worker failed"),
  );
  const memoryExtractionTimer = setInterval(() => {
    void processMemoryExtractionJobs(gatewayDeps).catch((err) =>
      logger.error(loggedError(err), "memory extraction worker failed"),
    );
  }, 10_000);
  memoryExtractionTimer.unref();

  void processMemorySynthesisJobs(gatewayDeps).catch((err) =>
    logger.error(loggedError(err), "memory synthesis worker failed"),
  );
  const memorySynthesisTimer = setInterval(() => {
    void processMemorySynthesisJobs(gatewayDeps).catch((err) =>
      logger.error(loggedError(err), "memory synthesis worker failed"),
    );
  }, 15_000);
  memorySynthesisTimer.unref();

  for (const agentId of recovered.agentIds) {
    void drainAgent(agentId, gatewayDeps);
  }

  // shortcut: no 7-day warning before an idle VM is removed; add that when a notification channel exists.
  const gcTimer = setInterval(() => {
    void gcIdleVMs(vm, db)
      .then((count) => {
        if (count > 0) logger.info({ count }, "terminated idle account VMs");
      })
      .catch((err) => logger.error(loggedError(err), "gc error"));
  }, 86_400_000);
  gcTimer.unref();

  void refreshVmMetrics().catch((err) =>
    logger.error(loggedError(err), "vm metrics refresh failed"),
  );
  const vmMetricsTimer = setInterval(() => {
    void refreshVmMetrics().catch((err) =>
      logger.error(loggedError(err), "vm metrics refresh failed"),
    );
  }, 30_000);
  vmMetricsTimer.unref();

  // 7. Listen
  Bun.serve({
    port: PORT,
    fetch: app.fetch,
    websocket,
  });
  logger.info({ port: PORT, telemetryEnabled }, "box-host ready");
}

if (import.meta.main) {
  runHostMain().catch((err) => {
    logger.fatal(loggedError(err), "startup failed");
    void shutdownTelemetry().finally(() => process.exit(1));
  });
}
