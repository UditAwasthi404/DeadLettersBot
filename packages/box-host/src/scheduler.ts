/** 3-lane run scheduler via Redis sorted sets (REQ-H10, H11, H12). */

import type { RedisClient } from "@agentOS/shared";

export type SchedulerLane = "user" | "agent" | "background";

export interface QueuePayload {
  turnId: string;
  runId: string;
  botId: string;
  accountId: string;
  priority?: boolean;
}

const PRIORITY_OFFSET = 1e12;

function queueKey(agentId: string, lane: SchedulerLane): string {
  return `queue:${agentId}:${lane}`;
}

export async function enqueue(
  redis: RedisClient,
  agentId: string,
  lane: SchedulerLane,
  payload: QueuePayload,
): Promise<void> {
  let score = Date.now();
  // REQ-H12: priority agent work beats background (and sits ahead of normal agent).
  if (lane === "agent" && payload.priority) {
    score = Date.now() - PRIORITY_OFFSET;
  }
  await redis.zadd(queueKey(agentId, lane), score, JSON.stringify(payload));
}

/** Pop highest-priority item: user → agent → background. */
export async function dequeue(
  redis: RedisClient,
  agentId: string,
): Promise<{ lane: SchedulerLane; payload: QueuePayload } | null> {
  for (const lane of ["user", "agent", "background"] as const) {
    const popped = await redis.zpopmin(queueKey(agentId, lane), 1);
    if (popped.length >= 2) {
      const member = popped[0];
      if (member === undefined) continue;
      return { lane, payload: JSON.parse(member) as QueuePayload };
    }
  }
  return null;
}

export async function hasQueuedWork(redis: RedisClient, agentId: string): Promise<boolean> {
  const counts = await Promise.all(
    (["user", "agent", "background"] as const).map((lane) => redis.zcard(queueKey(agentId, lane))),
  );
  return counts.some((count) => count > 0);
}
