import { randomUUID } from "node:crypto";
import type { RedisClient } from "@agentos/shared";

const LEASE_TTL_MS = 30_000;
const LEASE_RENEW_MS = 10_000;

const RENEW_LEASE = `
  if redis.call("get", KEYS[1]) == ARGV[1] then
    return redis.call("pexpire", KEYS[1], ARGV[2])
  end
  return 0
`;

const RELEASE_LEASE = `
  if redis.call("get", KEYS[1]) == ARGV[1] then
    return redis.call("del", KEYS[1])
  end
  return 0
`;

export interface WorkerLease {
  isHeld(): boolean;
  release(): Promise<void>;
}

/** Acquire an expiring Redis lease with owner-checked renewal and release. */
export async function acquireRedisLease(
  redis: RedisClient,
  key: string,
  onLost: () => void,
): Promise<WorkerLease | null> {
  const token = randomUUID();
  if ((await redis.set(key, token, "PX", LEASE_TTL_MS, "NX")) !== "OK") return null;

  let held = true;
  let renewInFlight = false;
  const lose = () => {
    if (!held) return;
    held = false;
    onLost();
  };
  const timer = setInterval(() => {
    if (!held || renewInFlight) return;
    renewInFlight = true;
    void redis
      .eval(RENEW_LEASE, 1, key, token, String(LEASE_TTL_MS))
      .then((result) => {
        if (result !== 1) lose();
      })
      .catch(lose)
      .finally(() => {
        renewInFlight = false;
      });
  }, LEASE_RENEW_MS);
  timer.unref();

  return {
    isHeld: () => held,
    async release() {
      clearInterval(timer);
      if (!held) return;
      held = false;
      await redis.eval(RELEASE_LEASE, 1, key, token);
    },
  };
}

/** Only one host may drain a bot queue at a time. */
export function acquireWorkerLease(
  redis: RedisClient,
  botId: string,
  onLost: () => void,
): Promise<WorkerLease | null> {
  return acquireRedisLease(redis, `worker:bot:${botId}:lease`, onLost);
}
