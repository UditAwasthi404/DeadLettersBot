import { routines } from "@agentOS/shared";
import { eq } from "drizzle-orm";
import { createDebouncer } from "./debounce.ts";
import type { GatewayDeps } from "./gateway.ts";
import { loggedError, logger } from "./logger.ts";
import { queueRoutine } from "./routine-queue.ts";
import { drainAgent } from "./worker.ts";
import { botWorkspacePath } from "./workspace-path.ts";

type Watch = { stop: () => Promise<void>; path: string };

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
      if (current?.path === path) continue;
      if (current) await current.stop().catch(() => undefined);
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
        watches.set(routine.id, { path, stop: watch.stop });
        void watch.done.then(() => {
          const active = watches.get(routine.id);
          if (active?.stop === watch.stop) watches.delete(routine.id);
        });
      } catch (err) {
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
