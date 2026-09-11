import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

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
