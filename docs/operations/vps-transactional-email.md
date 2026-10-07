# VPS transactional email integration

## Current boundary

The application defaults to Resend. This candidate adds an opt-in client for the
installed Tickets mail service at `https://mail.becoreops.com`, protocol revision
`dc8355093f42cb00501d9f587e494b25811af884` (historical draft PR #177). It does not
install or change that service, activate sending, provision credentials, change
DNS, send a test email, or alter customer templates or consent.

`TRANSACTIONAL_EMAIL_PROVIDER=vps` selects the VPS only for its supported kinds:
`payment_confirmation`, `registration_access`, `registration_update`,
`ticket_recovery`, `ticket_transfer`, `waitlist_offer`, `payment_recovery`,
`support_update`, `operational_alert`, `team_invitation`, `organizer_report`,
`organizer_invitation`, and `organizer_signup`.

Marketing campaigns, `event_announcement`, `owner_approval_request`,
`host_application_verify`, `host_application_decision`, and unknown future kinds
remain on Resend. The three newer owner/host-application kinds are not accepted
by the installed service. Existing Resend credentials and quota remain necessary.
The service's 2,000-message rolling 24-hour cap is a software safety limit, not a
provider allowance or a guarantee of inbox delivery.

## Delivery safety

- Requests use the existing HMAC-SHA256 protocol with body digest, timestamp,
  method and path. The HTTPS destination is fixed and redirects are rejected.
- `VPS_EMAIL_SIGNING_KEY` is server-only and must match the mail service key.
  Neither the secret nor any production configuration is part of this change.
- Each saved delivery pins its provider before the first network request. Legacy
  payloads without a provider stay on Resend, even after opting into VPS.
- Missing configuration, VPS pause (503) and quota (429) defer without exhausting
  retry attempts. An uncertain response is retried with the same provider and
  idempotency key. There is no automatic cross-provider fallback.
- Current expiry, access, host preference and campaign consent checks still run
  before retrying. Rows already carrying an accepted provider ID are never sent
  again by the application retry loop.
- Scheduled reconciliation polls only VPS rows awaiting evidence, even after a
  rollback to Resend. It cannot resend mail, affect unrelated IDs, overwrite
  terminal outcomes or replace newer evidence with older events. Missing IDs are
  rotated so they cannot block later messages from being checked.
- `sent` means accepted by the mail service; `delivered` means accepted by the
  recipient mail server. Neither establishes inbox placement or that it was read.

## Activation prerequisites (not performed)

1. Pass exact-candidate CI and complete an approved release of this client.
2. Have the VPS provider account manager set reverse DNS for `51.195.20.137` to
   `mail.becoreops.com`, then verify forward and reverse DNS agree. Verify SPF,
   DKIM signing and DMARC against the actual service before sending.
3. Verify signing-key presence and match without exposing secret values. The
   earlier installer configured a Cloudflare Worker secret; the current Node VPS
   application uses its own private runtime configuration. Worker configuration
   does not prove the Node application has the key. Any credential entry or
   persistent-access configuration needs separate authorization/handoff.
4. Obtain approval for activating service sending and an exact recipient for a
   single test. Confirm actual receipt and authenticated headers before routing
   customer traffic. Public health or DNS success alone is insufficient.
5. Under the approved activation plan, retain the sender
   `BeCore Tickets <tickets@becoreops.com>`, set the application provider opt-in,
   verify accepted-message reconciliation, and monitor bounces and deferrals.

Rollback new traffic by setting `TRANSACTIONAL_EMAIL_PROVIDER=resend`. Keep the
VPS service, its queue/database and the application signing key available to
finish already pinned deliveries and reconcile accepted messages. Removing the
service sending flag pauses acceptance/handoff but does not cancel messages
already in Postfix. Any emergency queue stop must preserve recoverable state.
Do not edit saved providers to move unresolved messages between transports.

## Verification

`tests/transactional-email.test.ts` runs in the existing Worker suite and the VPS
runtime suite. It covers supported-kind routing, unchanged Resend defaults,
request signing, configuration loss, rollback pins, deferred responses, retry
leases, preserved access checks, accepted-message deduplication, malformed IDs,
status ordering and polling fairness. No test contacts a real mail provider.
The existing candidate workflow provides aggregate exact-HEAD CI; no new workflow
or manual duplicate dispatch is needed. Production activation and inbox receipt
remain separate release gates.
