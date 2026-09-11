import { appleWalletUpdatesConfigured } from "@/lib/apple-wallet-updates";

export async function POST(request: Request) {
  const { env } = await import("cloudflare:workers");
  if (!appleWalletUpdatesConfigured(env)) return new Response(null, { status: 404 });
  const body = await request.json().catch(() => null) as { logs?: unknown } | null;
  if (!Array.isArray(body?.logs)) return new Response(null, { status: 400 });
  const logs = body.logs
    .filter((entry): entry is string => typeof entry === "string")
    .slice(0, 10)
    .map((entry) => entry.slice(0, 500));
  if (logs.length) console.info(JSON.stringify({ message: "apple wallet client log", logs }));
  return new Response(null, { status: 200 });
}
