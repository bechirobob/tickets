# SeevPlus checkout

SeevPlus is an optional Ghana Mobile Money provider. Paystack remains the default.
The checkout selector appears only when SeevPlus is explicitly enabled with
matching environment configuration and both secrets. An isolated `ENVIRONMENT=test`
runtime can start sandbox payments with the Checkout API key alone to test the
return-and-verify flow; real webhook delivery still requires its signing secret.
Booking fees remain the
existing BeCore booking fees; the provider's processing charge is not added as a
second customer fee.

## Configuration

| Setting | Purpose |
| --- | --- |
| `SEEV_ENABLED=true` | Offer new SeevPlus checkouts |
| `SEEV_ENVIRONMENT=sandbox` or `production` | Required provider environment |
| `SEEV_CHECKOUT_API_KEY` | Server secret for the Checkout API product |
| `SEEV_WEBHOOK_SECRET` | Server secret from the corresponding webhook endpoint |

Create the organization and Checkout API sandbox key at https://seevplus.com/developer.
Register the webhook URL for the same environment:

`https://<test-host>/api/payments/seevplus/webhook`

Subscribe to `payment.succeeded` and `payment.failed`. Store the key and webhook
signing secret with Wrangler's interactive `secret put` or the hosting dashboard;
do not put them in Git, chat, screenshots, CLI arguments or browser code. Local
work uses the ignored `.dev.vars` file. A local backend requires an HTTPS tunnel
for provider-initiated webhooks. Set public configuration in the deployed Worker
configuration so subsequent builds preserve it.

Sandbox keys must never be used to sell a real event on the production host.
The server blocks that combination. Use an isolated test Worker/database or a
local test environment (`ENVIRONMENT=test`). A preview event only accepts
sandbox, even if the Worker is configured for live SeevPlus payments.

## Verification before activation

1. Apply `0033_seevplus_checkout.sql` to the isolated test database, build, and
   configure the sandbox secrets. Do not reuse the production customer database.
2. Buy a test admission with each offered MoMo network. Exercise Seev's sandbox
   success and decline actions. Confirm the saved provider reference, amount and
   environment match. Sandbox is not evidence of actual network performance.
3. Verify that only a confirmed payment creates the expected number of tickets
   and that the original claim opens My Nights and The Room.
4. Close the browser before payment completion. Confirm webhook or scheduled
   recovery issues the tickets and sends the receipt.
5. Replay a successful webhook from Seev's dashboard. Confirm ticket count and
   confirmation metrics stay unchanged. Test a missed notification and temporary
   verification outage; let the five-minute recovery job run.
6. Confirm the account's refund process and perform a controlled live payment,
   refund and next-business-day settlement before enabling public sales.

Automated local checks:

```
npm run lint
npm run typecheck
npm test
npx drizzle-kit check
npx wrangler deploy --config dist/server/wrangler.json --dry-run
```

The dedicated browser suite uses deliberately invalid test credentials and
intercepts payment initiation, so it checks UI behavior without contacting Seev:

```
node scripts/prepare-seev-browser-fixture.mjs
npx playwright test --config playwright.seev.config.ts
```

It requires the normal isolated local fixture migrations and a future-dated
`after-dark-osu` preview event. It is excluded from the production browser suite.

## Recovery and financial boundaries

- Save each order, claim and exact checkout request before calling Seev. Reuse
  the order ID as the provider idempotency key. An ambiguous startup response
  remains pending. Recovery may replay the same request only while its local
  reservation is active, never after the provider key's 24-hour deduplication
  window. The saved request is removed after a reference is bound; unresolved
  request bodies are cleared after 24 hours.
- Verify by the stored provider reference. Browser query strings and webhook
  metadata cannot attach another person's transaction to an order. An explicit
  environment mismatch, wrong amount, wrong final amount or wrong currency does
  not issue tickets. Seev webhook amounts use major units; fulfillment uses the
  verification API's minor units instead.
- Signed notifications trigger current server-side verification, so stale failure
  notifications and manual retries with new event IDs cannot duplicate tickets.
  A shared 30-second database lease limits concurrent verification calls.
- Every five minutes, check up to 20 unresolved Seev orders from the last seven
  days, oldest checked first. Provider failures produce system alerts; session
  records retain a sanitized error. Unknown starts that outlive the reservation
  need provider review. Never assume an expired local reservation proves a
  payment failed. Older unresolved orders require finance review.
- Late successful payments issue tickets only if inventory remains available;
  otherwise the order becomes `requires_refund` with no ticket issuance.
- Turning `SEEV_ENABLED` off hides the option and stops new Seev orders. Keep the
  environment and secrets configured to finish existing payments and recovery.
- Admin order verification recognizes the provider and displays its reference.
  Paystack reconciliation and settlement reports include Paystack orders only.
  Seev payouts must be reconciled against the Seev dashboard until a provider
  settlement API is connected. Do not pay out Seev revenue from a Paystack
  settlement record.
- Automatic Seev refunds are not implemented: the provider's refund contract has
  not been supplied. Individual and mass Paystack refund paths reject Seev
  orders. Finance must arrange Seev refunds through the provider and verify
  completion before adjusting customer access; do not mark an order refunded
  merely because a refund was requested.

## Cloudflare outbound TLS recovery

The 2026-09-15 live check returned HTTP 525 from Worker `fetch` to Seev,
although Node HTTPS and a verified TLS socket from the same Worker reached the
official API. Reproduce connection failures from the actual Worker runtime before
attributing them to the provider or changing credentials.

`lib/seev-transport.ts` permits one fallback for HTTP 525 to
`api.seevplus.com:443` using `cloudflare:sockets` with TLS enabled. It preserves
the original body and idempotency key, limits time and response size, and rejects
ambiguous HTTP framing. It never changes the destination, disables certificate
verification, follows redirects or retries ordinary API errors. Both checkout
creation and verification use it; payment validation remains unchanged.

If both transports fail, preserve the order and inspect the sanitized session
error. Do not create a replacement payment or mark an unknown payment failed.
An expired reservation must be reacquired safely before any operator-approved
recovery, using the same request/key within the provider's deduplication window.

Targeted regression checks:
`npx vitest run tests/seev-transport.test.ts tests/seevplus.test.ts`.

## Integration references

- https://docs.seevcash.com/docs/payments/checkout
- https://docs.seevcash.com/docs/payments/verify
- https://docs.seevcash.com/docs/developer/webhooks
- https://docs.seevcash.com/docs/developer/api-keys

The provider representative describes a basic webhook retry, while the public
guide states a single automatic attempt and manual retries. The integration does
not depend on automatic retries. Real sandbox delivery still needs verification.

## Optional USDC checkout

`SEEV_CRYPTO_ENABLED=true` opts into USDC collection through Seev's `crypto`
channel. It defaults to off when absent and additionally requires all existing
Seev settings, a production key/environment and a non-test event. Sandbox and
preview events never expose it. Keep the flag off until the account owner has
created the organization's USDC wallet and the live checkout contract is verified.
No wallet is created by this application.

The customer selects **Crypto · USDC through SeevPlus**, then reviews the asset,
network and amount on Seev's hosted page. Tickets still quote and store their GHS
price, booking fee and total. The application neither calculates a conversion nor
instructs the customer to use a particular network. Creation must return the
original GHS amount/currency; verification must return the same reference,
amount, currency and confirmed `final_amount`. Any mismatch, missing crypto
`final_amount`, or unknown status holds fulfillment for review. A USDC settlement
amount in a webhook never substitutes for server-side order verification.

The provider's Payment Methods guide confirms `channels: ["crypto"]`, production
keys and a USDC account, but prohibits split payments. Tickets currently does not
send Seev subaccounts; internal organizer/promoter accounting is unchanged. A
persisted crypto request with a subaccount is rejected rather than dropping it.
The Checkout API overview still lists USDC as upcoming, and the public examples
do not show a GHS-quoted crypto verification response. Confirm that contract with
Seev before activation; do not loosen amount/currency matching to make it pass.
Source: https://docs.seevcash.com/docs/payments/channels (checked 2026-09-30).

Pending or expired Seev attempts block switching between MoMo and crypto as well
as switching providers. Same-attempt retries retain the original body and key.
Disabling either flag prevents new crypto checkouts but does not stop verification
or recovery of existing ones. Seev refunds, including USDC, continue to require
finance review; no automatic crypto transfer/refund is implemented.

### Release and rollback

The VPS is the active writer. On an authorized VPS release, include the code and
configuration-name allowlist update, leaving `SEEV_CRYPTO_ENABLED` absent/false.
After the owner confirms wallet readiness and the production contract/settlement
checks, set `SEEV_CRYPTO_ENABLED` to the string `"true"` in the VPS private runtime
configuration using a reviewed Tickets-only code-release procedure. The current
`tickets-vps-install.yml` workflow installs an isolated preview, not the active
service; do not mistake its success for a live release. No migration
or new secret is required. Do not activate the frozen Cloudflare fallback or
change hosting ownership for this feature. For rollback, set the crypto flag to
`"false"`; retain Seev environment/secrets to reconcile payments already started.
Live financial transactions must be performed by the account owner.

Mock-only checks:

```
npx vitest run --config vitest.vps.config.ts tests/seevplus.test.ts tests/seev-transport.test.ts tests/payment-selection.test.ts tests/payment-operations.test.ts
node scripts/prepare-seev-browser-fixture.mjs crypto
npx playwright test --config playwright.seev-crypto.config.ts
```

The crypto browser fixture changes only the local event to non-test and uses
invalid credentials. It intercepts initiation before provider traffic. Run the
regular fixture command without `crypto` to restore its sandbox-only event.

### Implementation verification (2026-09-30)

Candidate based on `d7206f9397fab7049c30c8eed37c39d3826d4919` passed locally:

- `npm run typecheck`; lint with no errors and one pre-existing moderation warning
- `npm test`: 19 repository, 43 UI, 1 password, 4 rendered and 503 Worker tests
- `npm run test:vps`: 20 Node adapter/operation tests and 503 VPS application tests
- `npm run build:vps` and `node scripts/verify-vps-runtime.mjs`
- `npx drizzle-kit check` and Worker deployment dry-run (nothing published)

Independent diff review found no blocking issue. Browser journeys were added but
not executed successfully here: the browser archive download was invalid, the
installed Chromium could not create its process socket, and the managed cloud
browser blocked localhost. Desktop Chromium, mobile Chromium and mobile WebKit
checks remain required in candidate CI. No real payment, wallet action, provider
secret change, remote push, activation or deployment was performed. The owner
confirmed wallet creation separately; live GHS-to-USDC contract and settlement
evidence remain outstanding.
