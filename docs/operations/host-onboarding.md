# Host onboarding and invitation release — 27 September 2026

Authorized scope: independent host signup, email confirmation, owner approval, activation without an event, then eight individually addressed onboarding invitations. Do not send the campaign until live links and persistence are verified. Recipient addresses and mail receipts stay outside this public repository.

Source base: main 31922f31c823d72d07bf614b3416c95b4f39d54c, also verified live before implementation (Worker version a5375955-1e66-4248-9689-325162122642).

## Flow

- `/organizer/join`: approved compact form; no event, poster, date or payment details.
- Application and confirmation email outbox persist atomically. Ten-minute resend cooldown; confirmed applications cannot be overwritten by public resubmission.
- `/organizer/join/confirm`: private fragment token, deliberate confirmation; pending verification is never approval.
- `/admin/hosts`: owner-only paginated queues, collapsed contact details, approval/decline, internal note, optional existing public profile selection.
- Approval atomically creates/reuses an eligible organizer account and verified profile, without assigning unrelated events. Existing privileged/disabled accounts are blocked for owner resolution.
- Existing one-time organizer activation handles passwords. Pending access recovers via scheduled processing. Decisions for existing activated hosts and declined applicants queue an outcome email.

Migration 0055 is additive. Apply before Worker publication; previous code tolerates the new table. Standard deployment captures a D1 recovery bookmark. Roll back code to the previous verified release if needed; preserve applications and outbox for forward recovery.

## Verification checkpoint

- Focused host application tests: 12 passing; existing activation/invitation suite previously 16 passing.
- Build, type checking and lint passed during implementation; final candidate CI remains authoritative after latest changes.
- Browser download unavailable locally; desktop/mobile Chromium and WebKit checks run in Candidate verification. Added form failure/retry, confirmation and owner-approval journeys.
- Next: complete exact-candidate CI, release, live submission/confirmation/queue verification, then send once and retain per-recipient provider receipts.

## Owner approval email alerts — 27 September 2026

New email-confirmed host applications and new event submissions (including submitted
organizer drafts) now create an atomic review-request outbox entry. Saved drafts and
unconfirmed hosts do not alert. Migration 0056 adds the outbox and triggers; there is
no historical backfill. Each form has one stable delivery/idempotency key.

The five-minute operations job moves requests to the existing retryable email queue,
addressed only to configured OPS_ALERT_EMAIL (currently the owner's Tickets inbox).
Provider quotas defer delivery; ordinary provider failures use the existing bounded
retry policy. Delivery acceptance is not proof of inbox arrival. Email uses the current
Resend transport until the separate VPS mail rollout is completed.

Review links select the exact host/event and retain their destination through login.
Host lookup is owner-only and works beyond the first page and after a decision.
Links contain record IDs, never approval credentials; opening one cannot approve.
Already-decided requests are discarded before being queued for email. Missing recipient
configuration leaves requests durable for later processing.

Rollback: restore the prior Worker; keep additive migration 0056 and captured requests.
No existing applications, payments, tickets or recipient settings are changed.
Focused verification: 24 tests passed across owner alerts, host onboarding and submission
uploads, covering transaction rollback, concurrency/replay, recipient isolation, draft
handling, provider failure/quota retries, HTML escaping and owner-only exact-ID access.
Exact-candidate CI, browser review-link checks and production deployment are pending.
