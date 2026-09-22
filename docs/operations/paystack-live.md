# Paystack live connection — 22 September 2026

The owner supplied the approved live Paystack connection and authorized replacing
the production test key. The VPS migration remains paused.

## Completed

- Existing Worker PAYSTACK_SECRET_KEY was replaced through the established
  Cloudflare Actions credential; no application code or database was deployed.
- The supplied live key was stored in GitHub Actions secrets, never in source.
- Paystack authenticated it through the read-only payment session timeout API.
  No customer, checkout, charge, transfer or refund was created by verification.
- Existing unrelated Worker secret names were verified as preserved.
- All 34 payment selection, live/test guard and fulfillment tests passed locally
  and in the exact-source configuration workflow.
- Source: 062c817c6c252765f965e12737c8b699390583a8, branch release/paystack-live.
- Successful configuration: run 35732422076, attempt 2, job 106761971812.

## Not yet verified or completed

Cloudflare returned HTTP 429/Error 1027 to the reference-free signed webhook
probe. This prevents claiming that live payments are ready. The signed probe
contains no payment reference and cannot create payment records.

Paystack's secure browser sign-in returned submission_failed. Automatic approval
review then rejected the follow-up browser access. No dashboard URLs, payment
channel settings, account approval settings or provider keys were changed there.
The supplied screenshot shows a Pre-Approved account badge; unrestricted live
collection has not been independently established.

Required Live Callback URL: https://tickets.becoreops.com/payment/return
Required Live Webhook URL: https://tickets.becoreops.com/api/payments/webhook

The application already sends the individual callback URL with its order
reference and claim token on each Paystack initialization. Preserve that behavior.
The dashboard webhook must still be saved and verified.

The supplied secret appeared in a screenshot and has not been rotated. Before
launch, rotate it in Paystack, replace PAYSTACK_SECRET_KEY in GitHub Actions
secrets, and rerun Configure Paystack live connection on release/paystack-live.
Never paste the replacement into source, logs, artifacts or chat. The public key
is not required by this server-side integration.

## Exact next action

Complete the dashboard callback/webhook settings and private key rotation through
an authorized account session. Once Cloudflare serves requests again, rerun the
configuration workflow to verify that the live signature receives 200 OK and an
unsigned request receives 401. A genuine paid checkout and ticket issuance remain
unverified; do not simulate a successful charge against production records.
