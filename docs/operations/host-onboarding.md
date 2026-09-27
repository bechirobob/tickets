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
