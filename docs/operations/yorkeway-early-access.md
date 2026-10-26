# The Yorke Way early-access list

Draft PR346; not deployed. The latest owner request replaces double opt-in with
single opt-in. Public route `/the-yorke-way`, owner list `/admin/yorkeway-audience`.

## Current design direction
Original metallic Yorke Way logo is the hero; no Kofi portrait, including social
cards. Cheeky public voice, sponsor secondary. Logo also leads the welcome email.
This supersedes the first portrait-led/confirmation-email preview.

## Consent and access
Name, normalized email, explicit unchecked consent, wording/version/date. Immediate
subscription on valid new submission; one welcome email. No verification claim,
account, event registration, ticket, QR, guaranteed entry, attendee import or campaign.
Only the owner can see this list. Known withdrawn addresses remain withdrawn on
anonymous resubmission; provider and platform suppression remain effective.

A hashed private withdrawal capability is emailed, not an account login. Opening
its link makes no change; explicit POST unsubscribes idempotently. Tokens stay out
of query strings, referrers and analytics. Signup closes at 2027-01-01T00:00:00Z.

## Delivery
One atomic database batch creates the consent row and deterministic welcome outbox
entry. Existing delivery loop processes it using the established Resend identity;
new email kind `yorkeway_welcome`. No VPS mail allowlist change. Failed/repeated
requests cannot enqueue duplicate welcomes. Retries recheck current subscription,
suppression and campaign closure. No live email test was sent during development.

The existing read-only readiness audit40383877809 on2026-10-26 verified Resend
credential presence, allowed sender, verified domain, current healthy deliveryloop
and empty queue. Quota and actual welcome delivery have not been tested.

## Release
Migration0070 has never been deployed; its draft schema was simplified before
release. Preserve current/previous production recovery releases. Require latest
exact-head tests, owner visual review of logo-only page/welcome email, standard
migration/backup/deployment checks and post-release route verification. Never merge
an older preview or claim the old confirmation workflow remains the intended flow.
