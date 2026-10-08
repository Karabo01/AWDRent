import "server-only";
import { env } from "@awdrent/config";
import { Redis } from "ioredis";

let client: Redis | undefined;

export function redis(): Redis {
  client ??= new Redis(env().REDIS_URL, { maxRetriesPerRequest: 2, enableOfflineQueue: false });
  return client;
}

// INCR + EXPIRE in one step, so concurrent requests cannot all slip past.
const CONSUME = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
if count > tonumber(ARGV[2]) then return {0, redis.call('TTL', KEYS[1])} end
return {1, -1}`;

/** Better Auth custom rate-limit storage backed by Redis (shared by all web instances). */
export const redisRateLimitStorage = {
  async consume(key: string, rule: { window: number; max: number }) {
    const [allowed, ttl] = (await redis().eval(CONSUME, 1, `rl:${key}`, rule.window, rule.max)) as [number, number];
    return { allowed: allowed === 1, retryAfter: allowed === 1 ? null : Math.max(ttl, 1) };
  },
};
