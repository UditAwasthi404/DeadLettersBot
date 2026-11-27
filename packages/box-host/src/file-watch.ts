import { routines } from "@agentos/shared";
import { eq } from "drizzle-orm";
import { createDebouncer } from "./debounce.ts";
import type { GatewayDeps } from "./gateway.ts";
import { loggedError, logger } from "./logger.ts";
import { queueRoutine } from "./routine-queue.ts";
import { type WorkerLease, acquireRedisLease } from "./worker-lease.ts";
import { drainAgent } from "./worker.ts";
import { botWorkspacePath } from "./workspace-path.ts";

type Watch = { stop: () => Promise<void>; path: string; lease: WorkerLease };

export function startFileChangeWatcher(deps: GatewayDeps): () => void {
  const watches = new Map<string, Watch>();
  const debounce = createDebouncer(1000);
  let stopped = false;

  async function fire(routineId: string, file: string) {
    const [routine] = await deps.db
      .select()
      .from(routines)
      .where(eq(routines.id, routineId))
      .limit(1);
    if (!routine?.enabled || routine.trigger.type !== "file_change") return;
    await queueRoutine(
      deps,
      routine,
      `File change: ${file}`.slice(0, 500),
      (botId) => void drainAgent(botId, deps),
    );
  }

  async function reconcile() {
    if (stopped) return;
    const rows = await deps.db.select().from(routines).where(eq(routines.enabled, true));
    const wanted = new Set<string>();
    for (const routine of rows) {
      if (routine.trigger.type !== "file_change") continue;
      const path = botWorkspacePath(routine.trigger.path);
      if (!path) continue;
      wanted.add(routine.id);
      const current = watches.get(routine.id);
      if (current?.path === path && current.lease.isHeld()) continue;
      if (current) await current.stop().catch(() => undefined);
      let stopUnderlying: (() => Promise<void>) | undefined;
      const lease = await acquireRedisLease(
        deps.redis,
        `worker:file-watch:${routine.id}:lease`,
        () => {
          void stopUnderlying?.().catch((err) =>
            logger.warn({ ...loggedError(err), routineId: routine.id }, "lost file-watch lease"),
          );
        },
      );
      if (!lease) continue;
      try {
        const vm = await deps.vm.provisionVM(routine.accountId);
        const watch = await deps.vm.watchFiles(vm.vmId, path, (file) => {
          debounce.trigger(routine.id, () => {
            void fire(routine.id, file).catch((err) =>
              logger.error(
                { ...loggedError(err), routineId: routine.id },
                "file-watch enqueue failed",
              ),
            );
          });
        });
        stopUnderlying = watch.stop;
        let stopped = false;
        const stop = async () => {
          if (stopped) return;
          stopped = true;
          await watch.stop();
          await lease.release();
        };
        watches.set(routine.id, { path, stop, lease });
        void watch.done.then(() => {
          const active = watches.get(routine.id);
          if (active?.stop === stop) {
            watches.delete(routine.id);
            void lease.release();
          }
        });
      } catch (err) {
        await lease.release().catch(() => undefined);
        logger.error({ ...loggedError(err), routineId: routine.id }, "file-watch could not start");
      }
    }
    for (const [id, watch] of watches) {
      if (wanted.has(id)) continue;
      debounce.clear(id);
      watches.delete(id);
      await watch.stop().catch(() => undefined);
    }
  }

  void reconcile().catch((err) => logger.error(loggedError(err), "file-watch reconcile failed"));
  const timer = setInterval(() => {
    void reconcile().catch((err) => logger.error(loggedError(err), "file-watch reconcile failed"));
  }, 15_000);
  timer.unref();
  return () => {
    stopped = true;
    clearInterval(timer);
    debounce.clear();
    for (const watch of watches.values()) void watch.stop().catch(() => undefined);
    watches.clear();
  };
}
