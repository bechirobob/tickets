# BeCore Tickets platform announcements

## Accepted scope (6 October 2026)

RSVP and checkout show one optional, initially unticked marketing line:
“Keep me posted on new nights from BeCore Tickets.” It replaces the former
new-booking event/host solicitation; it does not also grant host consent.
The separate interest-only event form keeps its event/host purpose and is unticked.
Existing event subscriptions, ticket validity, required terms and operational
notifications remain separate. No historic customer is enrolled automatically.

## Implemented boundary

- Migration `0061_platform_announcement_consent.sql` adds four tables without
  changing or backfilling existing contact lists. Choice version, timestamp,
  source and normalized email are recorded. Booking capture is atomic with
  source creation; original source receipts cannot be rewritten by a replay.
- A matching, currently verified signed-in identity can activate its checked
  choice immediately. Other checked choices remain pending and ineligible.
- A newly submitted, checked, unverified RSVP sends one existing-provider email
  confirmation link. Repeated submission does not send another. RSVP success
  does not depend on confirmation or optional email enqueue success.
- Paid checkout binds the existing receipt's verification grant to that exact
  pending choice. A purchase notice delivered by push also gets the one email
  proof. Existing confirmation retry/outbox dedup recovers enqueue failures.
- One existing email-confirmation action also confirms the bound choice, clearly
  stated on the email and confirmation screen. Grant type, ID, source receipt,
  pending revision, email, verified identity and claimed session must match.
  Expired/used/unrelated proof cannot subscribe; earlier proof cannot reverse a
  withdrawal. Older clients that do not disclose/confirm updates leave consent
  pending. Merely opening a link does not change the preference.
- Account privacy provides verified preference changes, withdrawal and a fresh
  explicit proof request. Stale revisions are rejected. An unverified booking
  session cannot inspect another person's subscription status.
- `/admin/platform-audience` and its API are owner-only. The deduplicated list
  excludes unverified/inactive/suppressed records. Organiser tools never receive
  the platform list. Existing provider-wide suppression remains effective.
- Future campaigns can use hashed revision-bound unsubscribe tokens. The
  current code contains no platform contact import, campaign sender or new
  schedule. Provider sync and sending remain disabled.
- Schema-driven backup already includes the new tables. Typed schema, restore
  rehearsal inventory and preview cleanup protect genuine/ambiguous consent,
  withdrawals and verification records.

## Retention and recovery

No invented retention period or destructive purge is introduced. Consent and
withdrawal evidence remain available to honour preferences and prevent replay.
A business retention policy and any requested erasure procedure require their
own explicit decision before destructive implementation.

If optional RSVP email preparation fails before a durable outbox row exists,
the RSVP remains valid and the choice stays pending. Account privacy can request
a fresh proof. Existing email retries handle failures after durable enqueue.

## Verification and release state

Implemented separately from customer email-design PR #246, based on main
`e96b686cf437dd9a3288d9cdd36cfae5a07bfe59`. No production migration, provider
import, campaign or real email was executed during implementation.

Focused consent suites pass on Worker/D1 and VPS/SQLite. Independent review
covered grant/identity binding, replay and unsubscribe, source separation,
owner access, atomic capture, checkout idempotency, cleanup and backup inventory.
Aggregate and rendered results are recorded in the draft PR after final checks.

Local browser launch is blocked by Chromium socket permissions. Synthetic
browser evidence is isolated test validation and cannot waive Candidate or
release admission. Main's dependency baseline still requires its separate
source-map-js/braces resolution; do not merge/deploy on a red release gate.

Local evidence before initial draft publication:
- Full Worker suite: 74 files / 665 tests passed, exit 0; runtime emitted an
  `EnvironmentTeardownError` warning after results.
- Consent suite: 19 tests passed on Worker/D1 and VPS/SQLite; four additional
  targeted retry/length/legacy-hash/failure-path cases subsequently passed on both.
- Repository checks: 125 passed; UI/password checks: 51 passed.
- TypeScript and lint passed (one existing moderation-worker export warning).
- Build and four rendered configuration/security checks passed. Subsequent
  access-screen-only loading-copy/timeout refinement is type/lint checked and
  will be compiled again by isolated preview CI.
- Independent cleanup review: four tests and a four-table isolated export/restore
  passed. No runtime or source dependency was installed/changed for this feature.
