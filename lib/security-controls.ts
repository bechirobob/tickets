export async function enforceRateLimit(
  limiter: { limit(input: { key: string }): Promise<{ success: boolean }> },
  key: string,
): Promise<boolean> {
  const result = await limiter.limit({ key });
  return result.success;
}
