import { Redis } from "@upstash/redis";
const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL ?? import.meta.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN ?? import.meta.env.UPSTASH_REDIS_REST_TOKEN,
});

const LIMITS = {
  anonymous: 3,
  free: 10,
  pro: 150,
} as const;

type PlanKey = keyof typeof LIMITS;

function todayKey(identifier: string): string {
  const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD UTC
  return `conversions:${date}:${identifier}`;
}

export async function getConversionsToday(identifier: string): Promise<number> {
  const key = todayKey(identifier);
  const count = await redis.get<number>(key);
  return count ?? 0;
}

export async function incrementConversions(identifier: string): Promise<number> {
  const key = todayKey(identifier);
  const count = await redis.incr(key);
  // Expira a las 48h para cubrir cualquier zona horaria
  await redis.expire(key, 60 * 60 * 48);
  return count;
}

export async function checkLimit(
  identifier: string,
  plan: PlanKey
): Promise<{ allowed: boolean; used: number; limit: number }> {
  const limit = LIMITS[plan];
  if (limit === Infinity) return { allowed: true, used: 0, limit: Infinity };

  const used = await getConversionsToday(identifier);
  return {
    allowed: used < limit,
    used,
    limit,
  };
}

export { LIMITS };
