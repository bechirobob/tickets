import { appleWalletUpdatesConfigured } from "@/lib/apple-wallet-updates";
import { requestMetadata } from "@/lib/admin-session";
import { hashToken } from "@/lib/attendee-auth";
import { enforceRateLimit } from "@/lib/security-controls";

export async function POST(request: Request) {
  const { env } = await import("cloudflare:workers");
  if (!appleWalletUpdatesConfigured(env)) return new Response(null, { status: 404 });
  const metadata = requestMetadata(request);
  const source = metadata.ip ?? metadata.userAgent ?? "unknown";
  if (!(await enforceRateLimit(env.PUBLIC_WRITE_RATE_LIMITER, `apple-wallet-log:${await hashToken(source)}`))) {
    return new Response(null, { status: 429 });
  }
  const body = await request.json().catch(() => null) as { logs?: unknown } | null;
  if (!Array.isArray(body?.logs)) return new Response(null, { status: 400 });
  const logs = body.logs
    .filter((entry): entry is string => typeof entry === "string")
    .slice(0, 10)
    .map((entry) => entry.slice(0, 500));
  if (logs.length) console.info(JSON.stringify({ message: "apple wallet client log", logs }));
  return new Response(null, { status: 200 });
}
