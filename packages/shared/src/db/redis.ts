import Redis from "ioredis";

export type RedisClient = Redis;

export function createRedis(url = process.env.REDIS_URL): RedisClient {
  if (!url) {
    throw new Error("REDIS_URL is required");
  }
  return new Redis(url, { maxRetriesPerRequest: 3, lazyConnect: true });
}
