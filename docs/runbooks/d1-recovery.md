# D1 recovery runbook

This runbook protects BeCore Tickets transaction, ticket, consent, entry and operational records. A recovery is successful only when the restored database passes integrity checks and the application journey is verified—not merely when a command exits successfully.

## Recovery layers

1. Cloudflare D1 Time Travel is the immediate point-in-time recovery layer. It is always enabled on production D1 databases.
2. The weekly `D1 recovery rehearsal` workflow exports production, restores that export into an isolated temporary SQLite database, validates the required schema and runs `quick_check` plus `integrity_check`.
3. Every deployment captures a pre-migration bookmark before applying migrations.

The weekly workflow never restores over production and never uploads the SQL export. It preserves only a bookmark and a non-sensitive validation report, then deletes the temporary export.

## Incident response

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

Run the rehearsal manually after any material schema change and review the scheduled report at least monthly.
