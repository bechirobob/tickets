import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import test from "node:test";

for (const existing of [true, false]) {
  test(`Wallet secret preparation returns to its importing build (${existing ? "existing" : "new"} secret)`, async (context) => {
    const calls = [];
    context.mock.method(childProcess, "spawnSync", (_command, args) => {
      calls.push(args);
      return { status: 0, stdout: args.includes("list") ? JSON.stringify(existing ? [{ name: "APPLE_WALLET_AUTH_SECRET" }] : []) : "" };
    });
    context.mock.method(process, "exit", (code) => {
      throw new Error(`Wallet preparation terminated its importing build with exit ${code}`);
    });
    syncBuiltinESMExports();
    try {
      await import(new URL(`../scripts/ensure-apple-wallet-secret.mjs?existing=${existing}`, import.meta.url));
      assert.equal(calls.filter((args) => args.includes("put")).length, existing ? 0 : 1);
    } finally {
      context.mock.restoreAll();
      syncBuiltinESMExports();
    }
  });
}

test("ticket Wallet actions stay provider-aware and off invalid passes", async () => {
  const [actions, ticketWallet, configRoute] = await Promise.all([
    readFile(new URL("../app/tickets/wallet-provider-actions.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/tickets/ticket-wallet.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/customer/wallet/config/route.ts", import.meta.url), "utf8"),
  ]);

  assert.match(actions, /\/api\/customer\/wallet\/config/u);
  assert.match(actions, /availability\.apple/u);
  assert.match(actions, /availability\.google/u);
  assert.match(actions, /platform=apple/u);
  assert.match(actions, /platform=google/u);
  assert.match(actions, /if \(!availability\?\.apple && !availability\?\.google\) return null/u);
  assert.match(ticketWallet, /ticketItem\.qrPayload && ticketItem\.gateCode[\s\S]*WalletProviderActions ticketId=\{ticketItem\.id\}/u);
  assert.doesNotMatch(actions, /APPLE_WALLET_SIGNER_TOKEN|GOOGLE_WALLET_PRIVATE_KEY/u);
  assert.match(configRoute, /Boolean\(env\.APPLE_WALLET_SIGNER_URL && env\.APPLE_WALLET_SIGNER_TOKEN\)/u);
  assert.match(configRoute, /Boolean\(env\.GOOGLE_WALLET_ISSUER_ID/u);
});
