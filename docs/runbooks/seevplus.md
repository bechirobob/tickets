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

## Integration references

- https://docs.seevcash.com/docs/payments/checkout
- https://docs.seevcash.com/docs/payments/verify
- https://docs.seevcash.com/docs/developer/webhooks
- https://docs.seevcash.com/docs/developer/api-keys

The provider representative describes a basic webhook retry, while the public
guide states a single automatic attempt and manual retries. The integration does
not depend on automatic retries. Real sandbox delivery still needs verification.
