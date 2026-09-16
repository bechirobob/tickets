# BeCore Tickets full audit — 16 September 2026

## Baseline and scope

Repository: `bechirobob/tickets`. Baseline main and verified production revision:
`7abdd948b7f947d51b128071678419eab0820a00`, Worker version
`d2e90f88-fe99-4c8e-8de3-d06b753a9d71`. Work branch:
`audit/full-system-2026-09-16`. Standing project approval covers repairs and release.
The release PR records final candidate, CI, migration and production evidence.

Mapped 41 page routes and 68 API route files plus the Room Durable Object,
cron tasks, announcement queue, D1 migrations, recovery and deployment workflows.
Reviewed payment initiation/verification, delayed callbacks and refunds, ticket
claims/recovery/transfer, pass generation, private sessions/Room delivery,
notifications, mail retry, staff/organizer permissions, guest search, uploads,
public caching/security headers, offline shell, packaged-client boundaries and
capacity tests. No synthetic transaction, refund, customer email or load test was
sent to production. Provider calls in new regression tests are isolated mocks.

## Findings and remediation

Five medium findings and two low findings; no new critical/high
finding was established in this audit. This is not a guarantee of absence.

| Severity | Finding and root cause | Remediation and verification |
| --- | --- | --- |
| Medium | Pass preparation trusted an `issued` ticket without checking the current payment. A stale row on refund-pending, refunded, refund-required or disputed orders still produced a QR and an entry promise. | Payment status now gates QR generation, pass presentation and Room links. My Nights retains the booking as history. Four failing-before/passing-after D1 regressions cover the states; a browser regression verifies the visible booking-history action. Gate admission already checked current payment, so this was a misleading pass, not proof of a gate bypass. |
| Medium | Initial Wallet export and Apple refresh queried nonexistent `attendee_accounts`, excluded valid sold-out events, and omitted current payment/holder state. Payment and holder changes did not invalidate Apple's cached pass. | Use `attendee_profiles`, allow existing paid admissions at sold-out events, and check current payment, holder, ownership, event removal and credential state. Apple refresh produces a void pass when access ends. Additive migration `0044_wallet_lifecycle.sql` advances update tags for order, holder and transfer changes. An actual route test reproduces the missing-table failure and verifies issuance plus conditional refresh after dispute. Live signing/physical Wallet acceptance remains a provider/device check. |
| Medium | Transactional mail treated quota rejection as an ordinary failure and exhausted its three attempts before a daily quota reset. Later retries could also send cancelled/expired private invitations. | All 429 responses preserve the retry budget and respect quota/reset delay. Recovery, transfer, waitlist and registration access retries check the current grant before sending; obsolete links are suppressed. Tests cover receipt quota/retry/delivery and missing grants for all four access-message kinds. No token lifetime is extended. Receipt links keep their original expiry. |
| Medium | Five Operations searches allowed 100–120 character input but used SQLite LIKE, whose D1 pattern limit is 50 bytes. A real long-name regression threw `LIKE or GLOB pattern too complex`. `%`/`_` also acted as wildcards instead of literal input. | Use parameterized, case-insensitive literal substring queries for audience, RSVP, orders, door list and ticket lookup. Long-name and literal-percent regressions verify results and counts without changing staff/event authorization. |
| Medium | The first Safari Seev checkout attempt lost the buyer name during hydration and passed only on retry. Controls accepted input before React could retain it. | Keep checkout controls disabled until client initialization completes, with a brief preparing label. The provider browser test now deliberately holds JavaScript, checks disabled controls, releases scripts and verifies the full existing validation/payment-failure journey without losing buyer details. |
| Low | Unused queue callback parameter generated a persistent lint warning. | Remove the unused parameter; no queue behavior changes. |
| Low | The actual iPhone simulator launch render exposed white status icons over the pale body background, unlike the browser-only layouts. | Give the native top safe area a fixed dark surface across event themes while retaining the existing light iOS icons. The region ignores touches and has zero height when there is no native inset. Verify the fresh simulator render. |

The Worker test config now resolves the existing `@/` source alias so route-level
Wallet tests exercise the real modules. The recovery fixture now includes real
active event records: invented orphan events are not valid admission evidence.
No test assertion was removed to conceal a product failure.

## Evidence and coverage

- Clean `npm ci`; complete dependency audit: zero known advisories (including dev dependencies).
- Repaired tree: lint with no warnings, typecheck, full `npm test` including 327 Worker/D1 tests across 45 files, migration validation and Worker deployment dry run passed.
- Baseline: lint (one warning), typecheck, production build, repository/UI/password/rendered tests, and 316 Worker/D1 tests passed.
- New regressions first reproduced four inactive-payment passes, the missing Wallet table, receipt quota budget exhaustion, and long-search failure. The initial test harness lacked the source alias; that setup error was fixed before recording product failures.
- Baseline exact-production browser run `35061293614`: **258 passed, 108 intentional skips, no passing retries**. The skipped cases are 36 provider/RSVP/Operations write-fixture cases per browser, exercised separately in the candidate matrix. Reviewed its desktop Chromium, mobile Chromium and mobile WebKit renders for public pages, expanded help/forms, My Nights, passes, notifications, Room reactions, concierge and Flashes. Read-only live browser checks covered discovery, navigation, event details, expanded RSVP, My Nights and notification privacy. Final candidate screenshots supersede changed screens.
- Fresh production smoke verified exact revision, public/registration catalogue, unauthenticated staff and registration denial, staff-page redirects and unsigned Seev webhook rejection. `/my-nights` returns no-store/noindex, CSP, HSTS, nosniff and frame denial.
- Static credential-pattern review found no credential value in the tracked source. The sole private-key-marker match is the PEM parsing expression, not a private key. This limited scan is not a complete historical secret audit.
- Inspected the successful **13 September D1 recovery rehearsal**, run `34749664387`: exported production, restored into isolated SQLite, quick/integrity checks `ok`, required tables present, export removed. This proves that rehearsal, not an in-place production restore or a complete disaster-recovery exercise. The new additive migration also triggers a fresh hosted rehearsal after merge.

## Capacity evidence and limits

Fresh isolated repaired-tree workerd/D1 test: 500 buyers competed for 400 admissions;
exactly 400 succeeded, 100 further sold-out attempts were denied, 800 signed
callback requests did not duplicate tickets, 400 independent claims/passes stayed
isolated, and 800 scans produced one valid scan per ticket. The Room accepted 400
connections and delivered all 48,000 expected deliveries from 120 messages over
60 seconds. A revoked silent guest received no next private message; 399 remaining
guests reconnected successfully.

Measured local p95: checkout 3,218 ms; callback burst 3,370 ms; 400 My Nights reads
311 ms; gate scan race 1,836 ms; Room delivery 42 ms. Compiled HTTP repaired build:
400 concurrent requests p95 784 ms, zero errors; sustained 40 requests/sec for
60 seconds (2,400 requests) p95 8 ms, zero errors. Exploratory 1,600-request
burst also had zero errors on this runner (p95 3,056 ms). These are local hardware
measurements, not a production SLA or permission to advertise 1,600-user capacity.
Final affected-route verification and candidate CI are recorded in the PR.

## Remaining external acceptance

- The owner is handling Cloudflare/Resend plans. Their current billing allowances
  were not read from authenticated provider accounts during this audit. Resend
  Free's published allowance is 100 transactional emails/day and 3,000/month;
  deferral cannot make 400 same-day receipts fit that allowance.
- Room notifications fan out to recipient rows: the 120-message capacity fixture
  produced 47,880 rows before index writes. A long, active event can exceed Free
  D1 daily writes. Hosted staging load on the chosen plan and an event-length
  soak remain necessary for an infrastructure guarantee.
- Earlier owner-confirmed live Seev payment remains historical acceptance, not a
  new payment test. This audit does not establish current MoMo-network throughput,
  provider settlement, bank payout or completed refund. Seev automatic refunds
  remain unimplemented because no provider refund contract is integrated;
  existing finance boundaries reject routing them through Paystack.
- Wallet signer credentials, physical Wallet refresh, physical camera/scanner,
  native push/background/resume, secure native account handoff, native private
  offline passes, permanent release signing and store review need their specific
  acceptance. Browser/simulator builds do not establish them.
- The first native event-link screenshot stops at iOS's “Open” confirmation.
  Simulator launch is verified; that capture does not prove completed deep-link
  navigation. Treat native deep-link/device acceptance as outstanding.
- Production delivery backlog, real-time provider latency, billing quotas and
  private operational alert contents were not inspected. No claim is made that
  they are empty or healthy solely because CI is green.

## Release / rollback

Apply additive migration 0044 through the established deployment workflow after
its pre-migration bookmark. It adds triggers only; it removes no records or columns
and is compatible with the prior Worker. No cleanup request is added or replayed.
The prior Worker/SHA above is the code rollback point; retain the additive triggers
on rollback. Do not restore production D1 to undo this code change.

## Current primary references

- [Cloudflare D1 limits](https://developers.cloudflare.com/d1/platform/limits/): bound parameters, LIKE pattern length, concurrency and Time Travel plan boundaries.
- [Resend quotas](https://resend.com/docs/knowledge-base/account-quotas-and-limits): daily/monthly email limits; actual account allowance remains unverified here.
