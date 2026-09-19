# Host guidance and reports

Approval now creates a private event draft and queues the existing single-use host invitation. The host can activate their account and prepare registration settings before staff publish the event. Approval does not publish an event or a public host profile. Publication preserves the host’s saved configuration.

Hosts land on At a glance, with their next assigned event selected. The checklist covers venue, map, lineup, guest setup and gate access. It shows pending requests, confirmed RSVP guests, paid orders, ticket face-value sales and recorded arrivals. Manual guest-list entries are included in expected attendance; generated RSVP guest-list entries are deduplicated. A shareable guest link appears only for a published, current event. Analytics links preserve the event and all-time range through sign-in.

## Automatic reports

Activated, active organizer accounts receive a weekly roundup from Monday 08:00 Ghana time, covering up to four upcoming events in the next 30 days. Recaps begin at the first 08:00 after an event ends, including events ending after midnight. The existing five-minute schedule queues bounded generation tasks; each task creates at most one roundup and one recap, so large batches may take longer. Rollout records prevent historical reports from being sent at launch. A seven-day recap catch-up window accommodates short outages.

Reports include aggregate counts and tracked sources, never guest names, contacts or payment credentials. Sales exclude booking fees and are not payout statements. Hosts can disable or enable reports under At a glance → Email reports. Disabling clears pending report payloads. Before delivery, the worker rechecks account status, role, email, password activation, event access, cancellation/removal, preference and expiry.

A durable unique account/kind/period record and atomic outbox prevent duplicate generation. Delivery uses the existing retry system and provider idempotency keys. Unsent reports expire after 24 hours, within the provider’s idempotency window. Failed/suppressed records stay available in delivery monitoring. Reports use the existing queue, sender and cron; no new service subscription is introduced. Queue batch size is one to keep report generation within per-invocation database query limits.

## Rehearsal and release

`tests/host-launch-rehearsal.test.ts` exercises approval → private preparation → invitation activation → login → publication → RSVP or paid registration → admission → duplicate-entry rejection → recap. It uses a real isolated D1 database and mocked payment/email providers. It does not prove real inbox placement, settlement or physical venue connectivity, and adds no production test guests or orders.

`tests/organizer-reports.test.ts` covers scoped summaries, generation races, cadence, overnight recaps, access revocation, opt-out, expiry, source counts and email escaping. Browser operations tests cover desktop, Android-sized and iPhone views, accessibility, preference failures/recovery and analytics deep links.

Migration 0050 is additive. Apply it before the new Worker. The deployment workflow captures a D1 recovery bookmark before applying migrations and verifies the live revision and unauthorized endpoint guards afterward. Roll back the Worker to the previous version if required; leave these additive tables in place. The prior Worker ignores report ledger rows and unknown report queue ticks. Pending reports must be suppressed before a rollback that removes their delivery-time validation.
