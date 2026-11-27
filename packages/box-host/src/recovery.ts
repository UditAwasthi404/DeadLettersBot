/** Re-enqueue pending work and reclaim running turns after their bot lease expires (REQ-H04). */

import { type Database, type RedisClient, bots, turns } from "@agentos/shared";
import { and, eq, or } from "drizzle-orm";
import { logger } from "./logger.ts";
import { enqueue } from "./scheduler.ts";

export async function recoverInProgressTurns(
  db: Database,
  redis: RedisClient,
): Promise<{ count: number; agentIds: string[] }> {
  const pending = await db
    .select()
    .from(turns)
    .where(or(eq(turns.state, "running"), eq(turns.state, "pending")));
  const agentIds = new Set<string>();
  let requeued = 0;
  for (const turn of pending) {
    if (turn.state === "running") {
      if (await redis.get(`worker:bot:${turn.botId}:lease`)) continue;
      const [recovered] = await db
        .update(turns)
        .set({ state: "pending" })
        .where(and(eq(turns.id, turn.id), eq(turns.state, "running")))
        .returning({ id: turns.id });
      if (!recovered) continue;
    }
    const [bot] = await db.select().from(bots).where(eq(bots.id, turn.botId)).limit(1);
    if (!bot) {
      logger.warn({ turnId: turn.id }, "recovery skipped a turn with no bot");
      continue;
    }
    const lane =
      turn.type === "user"
        ? "user"
        : turn.type === "routine" || turn.type === "subagent"
          ? "background"
          : "agent";
    await enqueue(redis, turn.botId, lane, {
      turnId: turn.id,
      runId: turn.runId,
      botId: turn.botId,
      accountId: bot.accountId,
      priority: turn.input.priority,
    });
    agentIds.add(turn.botId);
    requeued += 1;
  }
  if (requeued) logger.info({ count: requeued }, "re-enqueued pending turns");
  return { count: requeued, agentIds: [...agentIds] };
}
