import {
  type Database,
  type RedisClient,
  automationShadows,
  routineRuns,
  routines,
  skills,
  turns,
} from "@agentOS/shared";
import { and, eq } from "drizzle-orm";
import { enqueue } from "./scheduler.ts";

type RoutineQueueDeps = Pick<{ db: Database; redis: RedisClient }, "db" | "redis">;

export async function queueRoutine(
  deps: RoutineQueueDeps,
  routine: typeof routines.$inferSelect,
  inputText = "",
  startDrain: (botId: string) => void = () => {},
  hopCount = 0,
) {
  const [skill] = await deps.db
    .select()
    .from(skills)
    .where(and(eq(skills.id, routine.skillId), eq(skills.accountId, routine.accountId)))
    .limit(1);
  if (!skill) throw new Error("routine skill not found");
  const turnId = crypto.randomUUID();
  const runId = crypto.randomUUID();
  const [run] = await deps.db
    .insert(routineRuns)
    .values({ routineId: routine.id, status: "queued", inputSummary: inputText.slice(0, 500) })
    .returning();
  if (!run) throw new Error("routine run could not be recorded");
  const prompt = `Execute the routine "${routine.name}" using its attached skill. Trigger input: ${inputText || "scheduled run"}`;
  await deps.db.insert(turns).values({
    id: turnId,
    botId: routine.botId,
    runId,
    type: "routine",
    input: {
      prompt,
      attachments: [],
      nonce: crypto.randomUUID(),
      skillId: skill.id,
      routineId: routine.id,
      routineRunId: run.id,
      hopCount,
    },
    state: "pending",
  });
  await enqueue(deps.redis, routine.botId, "background", {
    turnId,
    runId,
    botId: routine.botId,
    accountId: routine.accountId,
  });
  await deps.redis.set(`run:${runId}:agentId`, routine.botId, "EX", 86400);
  startDrain(routine.botId);
  const triggeredAt = new Date();
  await deps.db
    .update(routines)
    .set({ lastTriggeredAt: triggeredAt, updatedAt: triggeredAt })
    .where(eq(routines.id, routine.id));
  await deps.db
    .update(automationShadows)
    .set({ lastTriggeredAt: triggeredAt, updatedAt: triggeredAt })
    .where(eq(automationShadows.routineId, routine.id));
  return { turnId, runId, routineRunId: run.id };
}

export async function queueSkillTest(
  deps: RoutineQueueDeps,
  botId: string,
  skill: typeof skills.$inferSelect,
  startDrain: (botId: string) => void = () => {},
) {
  const turnId = crypto.randomUUID();
  const runId = crypto.randomUUID();
  await deps.db.insert(turns).values({
    id: turnId,
    botId,
    runId,
    type: "routine",
    input: {
      prompt: `Execute the skill "${skill.name}" once as a confirmed test. Follow its steps, approval checkpoints, and error policy.`,
      attachments: [],
      nonce: crypto.randomUUID(),
      skillId: skill.id,
    },
    state: "pending",
  });
  await enqueue(deps.redis, botId, "background", {
    turnId,
    runId,
    botId,
    accountId: skill.accountId,
  });
  await deps.redis.set(`run:${runId}:agentId`, botId, "EX", 86400);
  startDrain(botId);
  return { turnId, runId, status: "queued" as const };
}
