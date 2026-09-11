import {
  appleWalletRequestAuthorized,
  appleWalletUpdatesConfigured,
  readAppleWalletPass,
  registerAppleWalletDevice,
  unregisterAppleWalletDevice,
} from "@/lib/apple-wallet-updates";
import { hashToken } from "@/lib/attendee-auth";
import { enforceCompositeRateLimit } from "@/lib/security-controls";

function validIdentifier(value: string, max = 180) {
  return value.length > 0 && value.length <= max && /^[A-Za-z0-9._:-]+$/u.test(value);
}

async function walletWriteAllowed(env: Cloudflare.Env, deviceLibraryId: string, serialNumber: string) {
  const [deviceHash, passHash] = await Promise.all([hashToken(deviceLibraryId), hashToken(serialNumber)]);
  return enforceCompositeRateLimit(env.PUBLIC_WRITE_RATE_LIMITER, [
    `apple-wallet-device:${deviceHash}`,
    `apple-wallet-pass:${passHash}`,
  ]);
}

export async function POST(
  request: Request,
  context: { params: Promise<{ deviceLibraryId: string; passTypeIdentifier: string; serialNumber: string }> },
) {
  const { env } = await import("cloudflare:workers");
  if (!appleWalletUpdatesConfigured(env)) return new Response(null, { status: 404 });
  const { deviceLibraryId, passTypeIdentifier, serialNumber } = await context.params;
  if (![deviceLibraryId, passTypeIdentifier, serialNumber].every((value) => validIdentifier(value))) return new Response(null, { status: 400 });
  if (!(await walletWriteAllowed(env, deviceLibraryId, serialNumber))) return new Response(null, { status: 429 });
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
  if (!(await walletWriteAllowed(env, deviceLibraryId, serialNumber))) return new Response(null, { status: 429 });
  if (passTypeIdentifier !== env.APPLE_WALLET_PASS_TYPE_IDENTIFIER) return new Response(null, { status: 404 });
  const pass = await readAppleWalletPass(env, passTypeIdentifier, serialNumber);
  if (!pass) return new Response(null, { status: 404 });
  if (!(await appleWalletRequestAuthorized(env, serialNumber, request.headers.get("authorization")))) return new Response(null, { status: 401 });
  await unregisterAppleWalletDevice(env, { passId: pass.id, deviceLibraryId });
  return new Response(null, { status: 200 });
}
