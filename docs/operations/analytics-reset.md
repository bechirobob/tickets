# Event analytics clean start

The owner requested a clean analytics baseline on 22 September 2026 so launch activity does not mix with earlier tests. This covers event activity counters, organizer charts/CSV, RSVP source analysis, host summaries and future report emails. It does not cancel admission or remove financial and operational records.

Migration 0053 creates `analytics_baseline` without performing the production reset. After the new Worker passes its revision smoke check, `scripts/reset-event-analytics.mjs` verifies the D1 recovery bookmark and inserts the fixed reset key once. The insert and its trigger atomically clear `product_metrics_daily` and suppress queued reports containing pre-reset snapshots. Future deployments find the receipt and do not clear new activity.

Sales reports use payments dated on or after the baseline; RSVP reports use requests submitted on or after it. Existing bookings still work. Pending approval queues, active admissions, support incidents and door operations remain authoritative live records. Dashboards/exports show the start timestamp, and comparisons with incomplete pre-reset periods are suppressed. Old payment and report delivery records remain available for audit.

The deployment saves aggregate before/after counts and the timestamp as `event-analytics-reset.json`, and records `analytics.reset` in the operational audit. Verification rejects any remaining pre-reset counters or a decrease in booking/access records. New guest activity arriving during verification is retained and can make counters nonzero immediately.

Automated browsers skip client analytics through `navigator.webdriver`; hosted tests and iPhone captures also send `x-becore-analytics: exclude`, which the endpoint ignores. Known automated user agents are ignored too. These are measurement exclusions, not an authentication mechanism. Real backend booking/payment events continue to count. General views and shares are activity counters, not proof of unique humans or causation.

Rollback: retain the additive schema and the reset receipt. Rolling back to code without baseline filtering would expose earlier order/RSVP aggregates again; forward-fix analytics instead. D1 Time Travel can recover the pre-reset database, but restoring it also rolls back concurrent real activity and requires a separately reviewed recovery decision.
