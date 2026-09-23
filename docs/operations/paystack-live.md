# Paystack live connection — verified 23 September 2026

## Current outcome

The Cloudflare Workers quota outage has cleared. At 2026-09-23T00:51:47Z,
https://tickets.becoreops.com/api/version returned HTTP 200 application JSON,
service becore-tickets, revision 31922f31c823d72d07bf614b3416c95b4f39d54c,
Worker version a5375955-1e66-4248-9689-325162122642. This was the application,
not a redirect or maintenance page.

The non-financial production checks passed at 2026-09-23T00:54:19.765Z:

- HMAC-SHA512-signed POST /api/payments/webhook with exactly
  {"event":"connection.check","data":{}} returned HTTP 200, body OK.
- The unsigned equivalent returned HTTP 401, body Invalid signature.
- GET /payment/return without a reference returned HTTP 200 with the expected
  application return page and Open My Nights link.
- Its anonymous GET /api/customer/session?paymentReturn=1 returned HTTP 401 with
  safe recovery guidance, without sign-in, a checkout URL or payment confirmation.
  Source review confirms the client uses this GET when reference/claim is absent.
- Source review confirms reference-free webhook probes return before database
  writes, financial operations, ticket fulfillment or email delivery.

Evidence: [verification run 35804046895](https://github.com/bechirobob/tickets/actions/runs/35804046895),
job 107000700487, successful at exact workflow commit
c54ec0ea564eeec0b8a27ebf1097722bdeabcf11 on release/paystack-live.
The job summary and logs retain the response assertions and verification time.

## Existing configuration and retained test evidence

- The supplied live PAYSTACK_SECRET_KEY remains in GitHub Actions and Worker
  becore-tickets. It was not exposed, reinstalled or rotated during verification.
- Initial configuration run 35732422076 attempt 2, job 106761971812, succeeded
  on source 062c817c6c252765f965e12737c8b699390583a8.
- That run authenticated the live key through Paystack's read-only
  integration/payment_session_timeout endpoint and preserved other Worker secrets.
- All 34 payment selection, live/test guard and fulfillment tests passed locally
  and in that configuration run. Payment source and dependencies are unchanged
  from deployed revision 31922f31c823d72d07bf614b3416c95b4f39d54c; these results
  were reused, not represented as a new test run.
- The workflow now verifies endpoints only, uses the existing Actions Paystack
  secret, and has no Cloudflare credential or deployment step. The original
  configure-paystack-live.mjs remains a historical configuration script and is
  not invoked by this verification workflow.
- No application deployment, public routing, database migration, guest-data
  change, email, checkout, charge, refund, transfer or ticket issuance occurred.
  The VPS migration remains paused.

## Owner-confirmed dashboard settings

The owner confirmed saving the following Live settings on 22 September 2026:

- Callback: https://tickets.becoreops.com/payment/return
- Webhook: https://tickets.becoreops.com/api/payments/webhook

These are owner-confirmed, not independently dashboard-verified. The application
also sends its individual callback with order reference and claim token during
real checkout; that behavior is unchanged.

The owner explicitly instructed keeping the current live key. Earlier notes
requiring rotation or saying these URLs remained unsaved are superseded.
Paystack browser sign-in previously failed and automatic approval review rejected
a follow-up action; no browser retry or bypass was attempted.

## Remaining boundary and next action

A genuine successful live payment through ticket issuance remains unverified.
The signed reference-free probe verifies endpoint reachability and the shared live
secret, not Paystack-originated delivery or end-to-end financial fulfillment.
Unrestricted live collection/account approval has not been independently
established. No synthetic successful payment was sent and no guest records were
inspected or changed.

Next: verify a legitimate live purchase through payment confirmation and ticket
issuance with appropriate authorization or safe existing read access.
The recovery-verification watch is complete and should remain disabled.
