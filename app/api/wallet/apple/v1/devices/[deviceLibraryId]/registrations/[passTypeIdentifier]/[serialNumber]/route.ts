import {
  appleWalletRequestAuthorized,
  appleWalletUpdatesConfigured,
  readAppleWalletPass,
  registerAppleWalletDevice,
  unregisterAppleWalletDevice,
} from "@/lib/apple-wallet-updates";

function validIdentifier(value: string, max = 180) {
  return value.length > 0 && value.length <= max && /^[A-Za-z0-9._:-]+$/u.test(value);
}

export async function POST(
  request: Request,
  context: { params: Promise<{ deviceLibraryId: string; passTypeIdentifier: string; serialNumber: string }> },
) {
  const { env } = await import("cloudflare:workers");
  if (!appleWalletUpdatesConfigured(env)) return new Response(null, { status: 404 });
  const { deviceLibraryId, passTypeIdentifier, serialNumber } = await context.params;
  if (![deviceLibraryId, passTypeIdentifier, serialNumber].every((value) => validIdentifier(value))) return new Response(null, { status: 400 });
  if (passTypeIdentifier !== env.APPLE_WALLET_PASS_TYPE_IDENTIFIER) return new Response(null, { status: 404 });
  const pass = await readAppleWalletPass(env, passTypeIdentifier, serialNumber);
  if (!pass) return new Response(null, { status: 404 });
  if (!(await appleWalletRequestAuthorized(env, serialNumber, request.headers.get("authorization")))) return new Response(null, { status: 401 });
  const body = await request.json().catch(() => null) as { pushToken?: unknown } | null;
  const pushToken = typeof body?.pushToken === "string" ? body.pushToken.trim() : "";
  if (!pushToken || pushToken.length > 512 || !/^[A-Za-z0-9_-]+$/u.test(pushToken)) return new Response(null, { status: 400 });
  const result = await registerAppleWalletDevice(env, { passId: pass.id, deviceLibraryId, pushToken });
  if (result === "missing") return new Response(null, { status: 404 });
  return new Response(null, { status: result === "created" ? 201 : 200 });
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ deviceLibraryId: string; passTypeIdentifier: string; serialNumber: string }> },
) {
  const { env } = await import("cloudflare:workers");
  if (!appleWalletUpdatesConfigured(env)) return new Response(null, { status: 404 });
  const { deviceLibraryId, passTypeIdentifier, serialNumber } = await context.params;
  if (![deviceLibraryId, passTypeIdentifier, serialNumber].every((value) => validIdentifier(value))) return new Response(null, { status: 400 });
  if (passTypeIdentifier !== env.APPLE_WALLET_PASS_TYPE_IDENTIFIER) return new Response(null, { status: 404 });
  const pass = await readAppleWalletPass(env, passTypeIdentifier, serialNumber);
  if (!pass) return new Response(null, { status: 404 });
  if (!(await appleWalletRequestAuthorized(env, serialNumber, request.headers.get("authorization")))) return new Response(null, { status: 401 });
  await unregisterAppleWalletDevice(env, { passId: pass.id, deviceLibraryId });
  return new Response(null, { status: 200 });
}
