import { describe, expect, test } from "bun:test";
import type { RedisClient } from "@agentOS/shared";
import { type QueuePayload, dequeue, enqueue } from "./scheduler.ts";

function memoryRedis() {
  const z = new Map<string, Map<string, number>>();
  return {
    async zadd(key: string, score: number, member: string) {
      if (!z.has(key)) z.set(key, new Map());
      z.get(key)?.set(member, score);
      return 1;
    },
    async zpopmin(key: string, _count = 1) {
      const set = z.get(key);
      if (!set || set.size === 0) return [];
      let best: string | undefined;
      let bestScore = Number.POSITIVE_INFINITY;
      for (const [m, s] of set) {
        if (s < bestScore) {
          bestScore = s;
          best = m;
        }
      }
      if (best === undefined) return [];
      set.delete(best);
      return [best, String(bestScore)];
    },
  } as unknown as RedisClient;
}

describe("scheduler", () => {
  test("user lane beats agent and background", async () => {
    const redis = memoryRedis();
    const agentId = "bot-1";
    const base: Omit<QueuePayload, "turnId"> = {
      runId: "r",
      botId: agentId,
      accountId: "a",
    };
    await enqueue(redis, agentId, "background", { ...base, turnId: "bg" });
    await enqueue(redis, agentId, "agent", { ...base, turnId: "ag" });
    await enqueue(redis, agentId, "user", { ...base, turnId: "u" });
    const first = await dequeue(redis, agentId);
    expect(first?.payload.turnId).toBe("u");
  });

  test("priority agent score is lower than normal", async () => {
    const redis = memoryRedis();
    const agentId = "bot-2";
    const base = { runId: "r", botId: agentId, accountId: "a" };
    await enqueue(redis, agentId, "agent", { ...base, turnId: "normal" });
    await enqueue(redis, agentId, "agent", {
      ...base,
      turnId: "prio",
      priority: true,
    });
    const first = await dequeue(redis, agentId);
    expect(first?.payload.turnId).toBe("prio");
  });
});
