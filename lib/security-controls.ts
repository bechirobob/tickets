import { recordSecurityEvent, requestMetadata } from "./admin-session";

type TurnstileEnvironment = {
  DB: D1Database;
  ENVIRONMENT?: string;
  TURNSTILE_SECRET_KEY?: string;
  TURNSTILE_SITE_KEY?: string;
};

type TurnstileResult = {
  success?: boolean;
  hostname?: string;
  action?: string;
  "error-codes"?: string[];
};

export async function verifyTurnstile(request: Request, token: string, expectedAction: string, env: TurnstileEnvironment): Promise<boolean> {
  const production = env.ENVIRONMENT === "production";
  const metadata = requestMetadata(request);
  const fail = async (detail: string) => {
    await recordSecurityEvent(env.DB, {
      kind: "turnstile_failed",
      subject: metadata.ip,
      path: new URL(request.url).pathname,
      requestId: metadata.requestId,
      detail,
    });
    return false;
  };
  if (!env.TURNSTILE_SECRET_KEY || !env.TURNSTILE_SITE_KEY) return production ? fail("turnstile_not_configured") : true;
  if (!token || token.length > 2048) return fail("token_missing_or_invalid");
  try {
    const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        secret: env.TURNSTILE_SECRET_KEY,
        response: token,
        remoteip: metadata.ip ?? undefined,
        idempotency_key: crypto.randomUUID(),
      }),
      signal: AbortSignal.timeout(5_000),
    });
    const result = await response.json<TurnstileResult>();
    const hostname = new URL(request.url).hostname;
    const valid = response.ok && result.success === true && result.action === expectedAction && result.hostname === hostname;
    return valid ? true : fail((result["error-codes"] ?? ["validation_failed"]).join(","));
  } catch (error) {
    return fail(error instanceof Error ? `validation_unavailable:${error.name}` : "validation_unavailable");
  }
}

export async function enforceRateLimit(
  limiter: { limit(input: { key: string }): Promise<{ success: boolean }> },
  key: string,
): Promise<boolean> {
  const result = await limiter.limit({ key });
  return result.success;
}
