import { env } from "cloudflare:test";
import { afterEach, expect, it, vi } from "vitest";
import {
  appleWalletAuthenticationToken,
  appleWalletPassSerial,
  appleWalletRequestAuthorized,
  listUpdatedAppleWalletPasses,
  processAppleWalletUpdatePushes,
  recordAppleWalletPass,
  registerAppleWalletDevice,
  signAppleWalletPass,
} from "../lib/apple-wallet-updates";

afterEach(() => vi.unstubAllGlobals());

function walletEnv() {
  return {
    ...env,
    APPLE_WALLET_SIGNER_URL: "https://signer.example/pass",
    APPLE_WALLET_SIGNER_TOKEN: "signer-secret",
    APPLE_WALLET_AUTH_SECRET: "wallet-auth-secret-at-least-32-characters",
    APPLE_WALLET_PASS_TYPE_IDENTIFIER: "pass.com.becoreops.tickets",
    APPLE_WALLET_PUSH_URL: "https://signer.example/push",
  } as unknown as Cloudflare.Env;
}

it("scopes Apple pass identity and auth to the ticket holder", async () => {
  const configured = walletEnv();
  const first = await appleWalletPassSerial("ticket-1", "attendee-a");
  const second = await appleWalletPassSerial("ticket-1", "attendee-b");
  expect(first).not.toBe(second);
  const token = await appleWalletAuthenticationToken(configured, first);
  expect(await appleWalletRequestAuthorized(configured, first, `ApplePass ${token}`)).toBe(true);
  expect(await appleWalletRequestAuthorized(configured, second, `ApplePass ${token}`)).toBe(false);
});

it("embeds the standard update contract only when dynamic Wallet is fully configured", async () => {
  const configured = walletEnv();
  const provider = vi.fn(async (_url: string, init?: RequestInit) => {
    const payload = JSON.parse(String(init?.body));
    expect(payload.serialNumber).toMatch(/^bct-/u);
    expect(payload.passTypeIdentifier).toBe("pass.com.becoreops.tickets");
    expect(payload.webServiceURL).toBe("https://tickets.becoreops.com/api/wallet/apple");
    expect(payload.authenticationToken).toBeTruthy();
    return new Response("pkpass", { status: 200 });
  });
  vi.stubGlobal("fetch", provider);
  const response = await signAppleWalletPass(configured, {
    id: "ticket-dynamic",
    eventSlug: "night-one",
    ticketType: "GA",
    holder: "Guest",
    title: "Night One",
    startsAt: "2026-09-20T20:00:00.000Z",
    endsAt: "2026-09-21T02:00:00.000Z",
    venue: "Venue",
    area: "Accra",
    qrPayload: "gate-token",
  }, "https://tickets.becoreops.com", "attendee-dynamic");
  expect(response?.ok).toBe(true);
  expect(provider).toHaveBeenCalledTimes(1);
});

it("registers a device and retries stale pass pushes until the signer accepts them", async () => {
  const configured = walletEnv();
  const serial = await appleWalletPassSerial("ticket-push", "attendee-push");
  await recordAppleWalletPass(configured, { id: "ticket-push", eventSlug: "night-push" }, "attendee-push", serial);
  expect(await registerAppleWalletDevice(configured, { passId: serial, deviceLibraryId: "device-library-123", pushToken: "abcdef0123456789" })).toBe("created");
  await env.DB.prepare("UPDATE apple_wallet_passes SET update_tag=update_tag+1 WHERE id=?").bind(serial).run();

  const failed = vi.fn(async () => new Response("no", { status: 503 }));
  vi.stubGlobal("fetch", failed);
  await expect(processAppleWalletUpdatePushes(configured)).rejects.toThrow(/503/u);
  expect(await env.DB.prepare("SELECT update_tag AS updateTag,last_pushed_tag AS pushedTag FROM apple_wallet_passes WHERE id=?").bind(serial).first())
    .toEqual({ updateTag: 2, pushedTag: 1 });

  const accepted = vi.fn(async () => Response.json({ invalidPushTokens: [] }));
  vi.stubGlobal("fetch", accepted);
  expect(await processAppleWalletUpdatePushes(configured)).toEqual({ pending: 1, pushed: 1 });
  expect(await env.DB.prepare("SELECT update_tag AS updateTag,last_pushed_tag AS pushedTag FROM apple_wallet_passes WHERE id=?").bind(serial).first())
    .toEqual({ updateTag: 2, pushedTag: 2 });
  expect(await listUpdatedAppleWalletPasses(configured, { deviceLibraryId: "device-library-123", passTypeIdentifier: "pass.com.becoreops.tickets", updatedSince: 1 }))
    .toEqual({ serialNumbers: [serial], lastUpdated: "2" });
});
