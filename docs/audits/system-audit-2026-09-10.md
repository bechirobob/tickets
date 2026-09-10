# Whole-system audit — 10 September 2026

Baseline: main and production `80288d571c3a5007449623963dc5881f291abaf3`, Worker `d67a45dc-5986-447a-bb3c-e97a32fde3d0`. The owner authorizes remediation and deployment. Current events, registrations, provider configuration and permanent mobile signing identity remain production data.

## Coverage

Public discovery, event details, checkout/return, RSVP, ticket recovery/transfers, My Nights, Room/Flashes/VIP, notifications, organizer workflows, every Operations destination, permissions, data removal, provider callbacks, scheduled processing, dependency/build/migration gates and desktop/mobile rendering.

## Findings and verification

| Finding | Impact | Remediation / evidence |
| --- | --- | --- |
| Ticket recovery selected the purchaser's orders rather than current ticket ownership | High: transferred tickets could return to the sender; recipients could not recover them | Implemented: recover only current assignments and unassigned purchases; protect claims against concurrent use |
| Transfer acceptance mutated assignments and QR credentials even when its claim lost a race | High: duplicate acceptance could change a valid pass | Implemented: unique claim ownership guards every mutation; reject checked-in, removed and revoked tickets |
| Recovery and transfer links consumed access on GET | Medium: email previews could consume the link | Implemented: inert landing page and explicit acceptance; retain old link compatibility |
| Partial refund callbacks were not idempotent | High: repeated callbacks could overstate refunds and void remaining admissions | Implemented: guarded refund transitions and an atomic reservation before provider requests |
| RSVP announcement consent was stored on the request but absent from the audience | Medium: willing guests appeared unsubscribed | Implemented: preserve original consent without treating it as email ownership or changing consent on retries |
| Paystack orders did not store test/live environment and real checkout lacked the production guard used by Seev | High: sandbox transactions could be treated as production bookings | Implemented: shared availability rules, explicit environment and matching verification |

Baseline checks: 206 Worker/D1 tests passed; npm audit reports zero known vulnerabilities. Previous preview cleanup is complete and must not be repeated as new data deletion.

Additional confirmed fixes:

- Concurrent wallet generation uses one stored QR credential.
- Approved RSVP requests automatically enter the staff door list without creating accounts or sending guest email. Admission remains single-use if a guest later opens My Nights. Cancellation removes door access.
- Door desk is searchable and paginated at ten entries, refreshes automatically, retains failed drafts and handles connection errors.
- Registration settings reject deadlines after the start and capacity below allocated paid admissions.
- Expired payments can become verified failures, allowing a later provider choice. Payment-return polling has cancellation and time limits.
- Email retries retain the original provider key, claim work once and do not downgrade delivered messages on older callbacks. Payment confirmation delivery has a stable database identity.
- Room messages and reactions check the current session, profile and admission; both are rate limited.
- Payout reservations account for overlapping settlement periods. Partial payouts retain their ledger and only complete the settlement once its balance is paid. A database trigger enforces the balance ceiling. Unknown refund callbacks create an Operations alert rather than altering a different refund.
- Refund batches derive progress from their ledger and wait for provider confirmation. Failed refunds and resolved disputes cannot reactivate removed or cancelled event tickets.
- Scheduled announcement failures are reported without preventing later jobs from running. External finance and email calls have time limits.
- Customer/member and organizer pages receive private no-store/noindex handling. Malformed public session and waitlist requests return useful errors; removed events cannot accept waitlist or door entries.

Migrations 0041–0042 preserve existing records. 0041 adds claim/refund guard fields. 0042 replaces the one-payout-per-settlement index with a balance guard and supplies door entries for existing approved RSVP guests. Keep the balance trigger on code rollback; do not restore the obsolete unique payout index after partial payouts exist. Baseline Worker version above is the code rollback reference; deployment captures the D1 bookmark.

Validation in progress: baseline 206 Worker tests; 226 passed after the first remediation set; new RSVP door test passed with its 46-test payment/Operations/RSVP group. Candidate runs must pass against the final commit, including all desktop/mobile browser and expanded Operations checks. No live customer payment, signup or outbound test email is required or performed by this audit.

## References

- [OWASP CSRF guidance](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html): keep state changes off GET and validate request origin.
- [Paystack verification](https://paystack.com/docs/payments/verify-payments/): match verified transactions before giving value.
- [Cloudflare Worker limits](https://developers.cloudflare.com/workers/platform/limits/): bound external requests and scheduled work.
- [Resend idempotency](https://resend.com/docs/dashboard/emails/idempotency-keys): retain one key when retrying an uncertain send.
- [WCAG 2.2](https://www.w3.org/WAI/WCAG22/quickref/): keyboard access, readable states and usable controls.

Final findings, exact candidate/merge, CI, deployment, production results and rollback evidence are recorded below and in the release PR as verification completes.
