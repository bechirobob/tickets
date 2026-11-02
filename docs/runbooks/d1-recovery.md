# Legacy D1 recovery runbook

Active Tickets runs on the VPS. Production recovery coverage is provided by
`Tickets encrypted production backup` (`.github/workflows/tickets-backup.yml`),
including its active-writer guard, isolated restore, encryption and download
verification. Those controls are unchanged by the legacy D1 applicability check.
Review that workflow's receipt separately; a successful applicability check does
not establish that a VPS backup or restore succeeded.

## Runtime and schema expectations

The weekly `Legacy D1 recovery applicability` workflow reads the fixed public
Tickets `/healthz` and `/api/version` endpoints. Both must identify
`becore-tickets`, with matching full commit revisions, and health must identify
`runtime: vps` and `active: true`. Redirects, unavailable endpoints, unknown
runtimes, inactive services and mismatched identities fail the check.

Only that verified active VPS state classifies `becore-tickets-db` as legacy and
records `result: not-applicable` and `restoreTested: false`. No Cloudflare secret,
D1 lookup, bookmark capture, SQL export or restore is used by this workflow.
Its artifact is an applicability report, **not recovery proof**. Unknown states
must be investigated, not treated as a reason to skip a failed restore.

Inactive D1 is not expected to track the current application's migrations. In
particular, an old export missing the announcement tables from migration 0061
must not prompt a production migration merely to satisfy this check. The offline
`scripts/rehearse-d1-recovery.sh` still strictly requires its current table set,
including all four announcement tables; import, integrity or schema failures
remain failures. It does not certify arbitrary historical schemas.

If D1 becomes active again, this workflow intentionally fails until the runtime
identity, exact database target and expected schema are explicitly reviewed and
implemented. Do not infer a D1 target from an unavailable VPS. Do not silently
relax required-table assertions for a legacy export.

## D1-only incident response (requires confirmed active D1)

The following procedure applies only after separately confirming that D1 is the
intended recovery target and establishing its schema expectations. It is not the
active VPS recovery procedure.

1. Pause public mutations or sales if continued writes could worsen the incident.
2. Record the UTC incident time, first known bad write, affected tables and current deployment SHA.
3. Capture the current bookmark before any corrective action:

   `npx wrangler d1 time-travel info DB --json`

4. Locate the newest known-good bookmark or timestamp. Verify it is before the first bad write.
5. Export the current database before considering an in-place restore:

   `npx wrangler d1 export DB --remote --output current-production.sql --skip-confirmation`

6. Run the isolated rehearsal against the export:

   `D1_EXPORT_FILE=current-production.sql npm run recovery:rehearse`

7. Obtain approval from two different authorised staff members for an in-place production restore. The requester must not be the final approver.
8. Restore only from a recorded bookmark or UTC timestamp:

   `npx wrangler d1 time-travel restore DB --bookmark=RECORDED_BOOKMARK`

   This is destructive: it overwrites the database and cancels in-flight queries. Do not automate this command.

9. Preserve the undo bookmark returned by Cloudflare.
10. Verify, in order: public event inventory, one test recovery link, one ticket lookup, staff sign-in, order/ticket counts, and a non-mutating gate lookup.
11. Reopen sales only after finance, entry and customer recovery checks agree.
12. Record the restored bookmark, approvers, production SHA, checks and customer impact in the operational audit trail.

## Rehearsal acceptance criteria

- SQL export is non-empty and has a SHA-256 checksum.
- Isolated import succeeds.
- SQLite `quick_check` and `integrity_check` both return `ok`.
- Events, orders, tickets, staff accounts, consent records, delivery records and product metrics tables are present.
- Aggregate row counts are written to the report without exporting customer data.
- Production is not modified.

For an explicitly authorised D1 rehearsal, review schema expectations before exporting. Review active VPS backup receipts separately from the weekly legacy applicability report.
