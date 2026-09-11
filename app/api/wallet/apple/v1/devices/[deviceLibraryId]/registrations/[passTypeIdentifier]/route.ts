import { appleWalletUpdatesConfigured, listUpdatedAppleWalletPasses } from "@/lib/apple-wallet-updates";

function validIdentifier(value: string, max = 180) {
  return value.length > 0 && value.length <= max && /^[A-Za-z0-9._:-]+$/u.test(value);
}

export async function GET(
  request: Request,
  context: { params: Promise<{ deviceLibraryId: string; passTypeIdentifier: string }> },
) {
  const { env } = await import("cloudflare:workers");
  if (!appleWalletUpdatesConfigured(env)) return new Response(null, { status: 404 });
  const { deviceLibraryId, passTypeIdentifier } = await context.params;
  if (!validIdentifier(deviceLibraryId) || !validIdentifier(passTypeIdentifier)) return new Response(null, { status: 400 });
  if (passTypeIdentifier !== env.APPLE_WALLET_PASS_TYPE_IDENTIFIER) return new Response(null, { status: 404 });
  const raw = new URL(request.url).searchParams.get("passesUpdatedSince") ?? "0";
  const updatedSince = Number(raw);
  if (!Number.isSafeInteger(updatedSince) || updatedSince < 0) return new Response(null, { status: 400 });
  const updates = await listUpdatedAppleWalletPasses(env, { deviceLibraryId, passTypeIdentifier, updatedSince });
  if (!updates) return new Response(null, { status: 204 });
  return Response.json(updates, { headers: { "cache-control": "no-store" } });
}
