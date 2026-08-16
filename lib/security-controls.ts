export type RateLimiter = { limit(input: { key: string }): Promise<{ success: boolean }> };

export async function enforceRateLimit(
  limiter: RateLimiter,
  key: string,
): Promise<boolean> {
  const result = await limiter.limit({ key });
  return result.success;
}

export async function enforceCompositeRateLimit(limiter: RateLimiter, keys: string[]): Promise<boolean> {
  const results = await Promise.all(keys.map((key) => enforceRateLimit(limiter, key)));
  return results.every(Boolean);
}
